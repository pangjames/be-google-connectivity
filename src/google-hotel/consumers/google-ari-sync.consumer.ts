import { Injectable, Logger } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import Bottleneck from 'bottleneck';
import { Hotel } from '../../common/entities/hotel.entity';
import { CalendarMaterializerService } from '../services/calendar-materializer.service';
import { CalendarRepositoryService } from '../services/calendar-repository.service';
import { GoogleApiService } from '../services/google-api.service';
import { RateBuilder } from '../builders/rate.builder';
import { AvailabilityBuilder } from '../builders/availability.builder';
import { InventoryBuilder } from '../builders/inventory.builder';

@Injectable()
export class GoogleAriSyncConsumer {
  private readonly logger = new Logger(GoogleAriSyncConsumer.name);
  
  private limiter = new Bottleneck({
    minTime: 100,
    maxConcurrent: 1
  });

  constructor(
    private dataSource: DataSource,
    private readonly materializer: CalendarMaterializerService,
    private readonly calendarRepo: CalendarRepositoryService,
    private readonly googleApi: GoogleApiService
  ) {}

  async handleBatchMessages(messages: Message[]) {
    for (const message of messages) {
      // 1. SAFE PARSING: Extract raw SQS payload
      let payload;
      try {
        payload = typeof message.Body === 'string' ? JSON.parse(message.Body) : message.Body;
      } catch (err) {
        this.logger.warn(`[ARI SYNC SKIPPED] Invalid JSON. Skipping this SQS message.`);
        continue;
      }

      if (!payload) {
        this.logger.warn(`[ARI SYNC SKIPPED] Empty payload.`);
        continue;
      }

      const { hotelCode, roomId, rateId, updateType } = payload;
      
      // 2. Mandatory Parameter Validation
      if (!hotelCode) {
        this.logger.warn(`[ARI SYNC SKIPPED] hotelCode not found in payload.`);
        continue;
      }

      // Fallback handling to align single date parameters (Delta Sync)
      const startDate = payload.startDate || payload.date;
      const endDate = payload.endDate || payload.date;

      if (!startDate || !endDate) {
        this.logger.warn(`[ARI SYNC SKIPPED] Sync cancelled. Incomplete date parameters for hotel: ${hotelCode}`);
        continue;
      }
      
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        this.logger.log(`Starting sync [${updateType || 'FULL_SYNC'}] for hotel: ${hotelCode} (${startDate} to ${endDate})`);

        // 1. Pessimistic Lock for ARI synchronization
        await queryRunner.manager
          .createQueryBuilder(Hotel, 'hotel')
          .setLock('pessimistic_write')
          .where('hotel.code = :code', { code: hotelCode })
          .getOne();

        // 2. Materialize with optional parameters
        await this.materializer.materialize(hotelCode, startDate, endDate, queryRunner, roomId, rateId);
        
        // 3. Fetch materialized inventory data
        const inventories = await this.calendarRepo.getInventoriesForDateRange(hotelCode, startDate, endDate, queryRunner, roomId, rateId);
        
        // 4. Push to Google with Rate Limiter
        if (inventories?.length > 0) {
          await this.limiter.schedule(async () => {
            await this.googleApi.pushPayload(hotelCode, RateBuilder.buildRateAmountNotifRQ(hotelCode, inventories), 'Rate');
            await this.googleApi.pushPayload(hotelCode, AvailabilityBuilder.buildAvailNotifRQ(hotelCode, inventories), 'Avail');
            await this.googleApi.pushPayload(hotelCode, InventoryBuilder.buildInvCountNotifRQ(hotelCode, inventories), 'Inv');
          });
        }

        await queryRunner.commitTransaction();
        this.logger.log(`[SUCCESS] Sync completed for hotel: ${hotelCode}`);

      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`[FAILED] ARI Sync for hotel ${hotelCode}:`, error);
        throw error; // Trigger SQS retry
      } finally {
        await queryRunner.release();
      }
    }
  }
}