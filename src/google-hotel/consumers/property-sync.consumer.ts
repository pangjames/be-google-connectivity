import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
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

  @SqsMessageHandler('property-sync-queue.fifo', true)
  async handleBatchMessages(messages: Message[]) {
    for (const message of messages) {
      const { entityReference, updateType } = JSON.parse(message.Body as string);
      const hotelId = entityReference?.hotel_id;

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

        // 1. Menjalankan pemrosesan database & validasi dalam transaksi
        result = await this.propertyMaterializerService.handleExtranetDeltaUpdate(entityReference, updateType, queryRunner);

        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Gagal memproses transaksi database hotel ${hotelId}`, error);
        throw error; // Lempar kembali agar SQS retry
      } finally {
        await queryRunner.release();
      }

      // 2. Menjalankan pemanggilan API eksternal di luar transaksi database
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
          this.logger.error(`Gagal mengirim data Google untuk hotel ${result.hotelCode}`, apiError);
          throw apiError; // Lempar agar SQS retry (data DB sudah aman ter-commit)
        }
      }
    }
  }
}