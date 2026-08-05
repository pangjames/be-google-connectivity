import { Injectable, Logger } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { PropertyMaterializerService } from '../services/property-materializer.service';
import { Hotel } from '../../common/entities/hotel.entity';

@Injectable()
export class PropertySyncConsumer {
  private readonly logger = new Logger(PropertySyncConsumer.name);

  constructor(
    private readonly propertyMaterializerService: PropertyMaterializerService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Processes a batch of SQS messages for property synchronization.
   * Handles database transactions, pessimistic locking, and subsequent external API push executions.
   */
  async handleBatchMessages(messages: Message[]) {
    for (const message of messages) {
      // 1. SAFE PARSING: Catch JSON formatting errors without triggering SQS retries
      let payload: any;
      try {
        payload = typeof message.Body === 'string' ? JSON.parse(message.Body) : message.Body;
      } catch (parseErr) {
        this.logger.warn(`[PROPERTY CONSUMER SKIPPED] Invalid JSON payload in Message ID: ${message.MessageId}. Message discarded.`);
        continue;
      }

      if (!payload || !payload.entityReference) {
        this.logger.warn(`[PROPERTY CONSUMER SKIPPED] Missing entityReference or empty payload in Message ID: ${message.MessageId}`);
        continue;
      }

      const { entityReference, updateType } = payload;
      const hotelId = entityReference?.hotelId;

      if (!hotelId) {
        this.logger.warn(`[PROPERTY CONSUMER SKIPPED] Missing mandatory hotelId in entityReference.`);
        continue;
      }

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let result: { 
        shouldPush: boolean; 
        hotelCode: string; 
        flatData: any[]; 
        roomTypeId?: number; 
        ratePlanId?: number;
        deletedSetups?: any[];
        shouldTeardown?: boolean;
      } | null = null;

      try {
        const qb = queryRunner.manager
          .createQueryBuilder(Hotel, 'hotel')
          .setLock('pessimistic_write');
          
        const numericHotelId = Number(hotelId);
        if (!isNaN(numericHotelId)) {
          await qb.where('hotel.id = :id', { id: numericHotelId }).getOne();
        } else {
          await qb.where('hotel.code = :code', { code: String(hotelId) }).getOne();
        }

        // 2. Execute database processing & validation inside the transaction
        result = await this.propertyMaterializerService.handleExtranetDeltaUpdate(entityReference, updateType, queryRunner);

        if (result) {
          this.logger.log(
            `[PROPERTY CONSUMER] Executed: shouldPush=${result.shouldPush}, shouldTeardown=${result.shouldTeardown}, hotelCode=${result.hotelCode}`
          );
        } else {
          this.logger.debug(`[PROPERTY CONSUMER] Skipping message for hotel ${hotelId}: Condition/Setup not met.`);
        }
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Failed to process database transaction for hotel ${hotelId}`, error);
        throw error; // Rethrow to trigger SQS retry
      } finally {
        await queryRunner.release();
      }

      // 3. Execute external API calls outside of the database transaction
      if (result) {
        if (result.shouldPush) {
          try {
            // A. If any Room/Rate is deleted, perform Partial Teardown first
            if (result.deletedSetups && result.deletedSetups.length > 0) {
              this.logger.log(`[PARTIAL TEARDOWN] Master Close for deleted room/rate on ${result.hotelCode}`);
              await this.propertyMaterializerService.executeTeardown(result.hotelCode, result.deletedSetups);
            }

            // B. Proceed to push the latest data (Static Feed without the deleted Room/Rate)
            await this.propertyMaterializerService.executeExternalPush(
              result.hotelCode, 
              result.flatData, 
              updateType,
              result.roomTypeId,
              result.ratePlanId
            );
          } catch (apiError) {
            this.logger.error(`Failed to dispatch Google data for hotel ${result.hotelCode}`, apiError);
            throw apiError; 
          }
        } 
        // C. FULL TEARDOWN: If gatekeeper fails and status drops to 0
        else if (result.shouldTeardown) {
          try {
            await this.propertyMaterializerService.executeTeardown(result.hotelCode, result.flatData);
          } catch (teardownError) {
            this.logger.error(`Failed teardown for hotel ${result.hotelCode}`, teardownError);
            throw teardownError;
          }
        }
      }
    }
  }
}