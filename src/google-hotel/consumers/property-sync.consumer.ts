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
      const { entityReference, updateType } = JSON.parse(message.Body as string);
      const hotelId = entityReference?.hotelId;

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let result: { shouldPush: boolean; hotelCode: string; flatData: any[]; roomTypeId?: number; ratePlanId?: number } | null = null;

      try {
        const qb = queryRunner.manager
          .createQueryBuilder(Hotel, 'hotel')
          .setLock('pessimistic_write');
          
        if (typeof hotelId === 'number') {
          await qb.where('hotel.id = :id', { id: hotelId }).getOne();
        } else {
          await qb.where('hotel.code = :code', { code: hotelId }).getOne();
        }

        // 1. Execute database processing & validation inside the transaction
        result = await this.propertyMaterializerService.handleExtranetDeltaUpdate(entityReference, updateType, queryRunner);

        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Failed to process database transaction for hotel ${hotelId}`, error);
        throw error; // Rethrow to trigger SQS retry
      } finally {
        await queryRunner.release();
      }

      // 2. Execute external API calls outside of the database transaction
      if (result && result.shouldPush) {
        try {
          await this.propertyMaterializerService.executeExternalPush(
            result.hotelCode, 
            result.flatData, 
            updateType,
            result.roomTypeId,
            result.ratePlanId
          );
        } catch (apiError) {
          this.logger.error(`Failed to dispatch Google data for hotel ${result.hotelCode}`, apiError);
          throw apiError; // Rethrow for SQS retry (DB data is safely committed)
        }
      }
    }
  }
}