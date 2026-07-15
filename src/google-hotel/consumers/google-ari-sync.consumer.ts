import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
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

  @SqsMessageHandler('google-sync-queue.fifo', true)
  async handleBatchMessages(messages: Message[]) {
    for (const message of messages) {
      // 1. Ekstrak payload mentah dari SQS
      const payload = JSON.parse(message.Body as string);
      const { hotelCode, roomId, rateId, updateType } = payload;
      
      // 2. Fallback handling untuk menyelaraskan parameter tanggal tunggal (Delta Sync)
      const startDate = payload.startDate || payload.date;
      const endDate = payload.endDate || payload.date;

      if (!startDate || !endDate) {
        this.logger.error(`[LEWATKAN] Sinkronisasi dibatalkan. Parameter tanggal tidak lengkap untuk hotel: ${hotelCode}`);
        continue;
      }
      
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        this.logger.log(`Memulai sinkronisasi [${updateType || 'FULL_SYNC'}] untuk hotel: ${hotelCode} (${startDate} s/d ${endDate})`);

        // 1. Pessimistic Lock untuk sinkronisasi ARI
        await queryRunner.manager
          .createQueryBuilder(Hotel, 'hotel')
          .setLock('pessimistic_write')
          .where('hotel.code = :code', { code: hotelCode })
          .getOne();

        // 2. Materialize dengan parameter opsional
        await this.materializer.materialize(hotelCode, startDate, endDate, queryRunner, roomId, rateId);
        
        // 3. Ambil data hasil materialisasi
        const inventories = await this.calendarRepo.getInventoriesForDateRange(hotelCode, startDate, endDate, queryRunner, roomId, rateId);
        
        // 4. Push ke Google dengan Rate Limiter
        if (inventories?.length > 0) {
          await this.limiter.schedule(async () => {
            await this.googleApi.pushPayload(hotelCode, RateBuilder.buildRateAmountNotifRQ(hotelCode, inventories), 'Rate');
            await this.googleApi.pushPayload(hotelCode, AvailabilityBuilder.buildAvailNotifRQ(hotelCode, inventories), 'Avail');
            await this.googleApi.pushPayload(hotelCode, InventoryBuilder.buildInvCountNotifRQ(hotelCode, inventories), 'Inv');
          });
        }

        await queryRunner.commitTransaction();
        this.logger.log(`[SUKSES] Sinkronisasi selesai untuk hotel: ${hotelCode}`);

      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`[GAGAL] Sinkronisasi ARI untuk hotel ${hotelCode}:`, error);
        throw error; // Trigger SQS retry
      } finally {
        await queryRunner.release();
      }
    }
  }
}