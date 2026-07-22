import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { PropertySyncConsumer } from './property-sync.consumer';
import { GoogleAriSyncConsumer } from './google-ari-sync.consumer';
import { PromotionSyncConsumer } from './promotion-sync.consumer';

@Injectable()
export class GoogleDispatcherConsumer {
  private readonly logger = new Logger(GoogleDispatcherConsumer.name);

  constructor(
    @Inject(forwardRef(() => PropertySyncConsumer))
    private readonly propertySyncConsumer: PropertySyncConsumer,
    @Inject(forwardRef(() => GoogleAriSyncConsumer))
    private readonly googleAriSyncConsumer: GoogleAriSyncConsumer,
    @Inject(forwardRef(() => PromotionSyncConsumer))
    private readonly promotionSyncConsumer: PromotionSyncConsumer,
  ) {}

  @SqsMessageHandler('google-connectivity-queue', true)
  async handleBatchMessages(messages: Message[]) {
    for (const message of messages) {
      try {
        const payload = JSON.parse(message.Body as string);
        if (payload.promotionId || payload.updateType === 'PROMOTION_UPDATE') {
          this.logger.log(`[ROUTE: PROMOTION] Pesan ID: ${message.MessageId} diteruskan ke PromotionSyncConsumer`);
          await this.promotionSyncConsumer.handleBatchMessages([message]);
        } else if (payload.entityReference) {
          this.logger.log(`[ROUTE: PROPERTY] Pesan ID: ${message.MessageId} diteruskan ke PropertySyncConsumer`);
          await this.propertySyncConsumer.handleBatchMessages([message]);
        } else if (payload.hotelCode) {
          this.logger.log(`[ROUTE: ARI] Pesan ID: ${message.MessageId} diteruskan ke GoogleAriSyncConsumer`);
          await this.googleAriSyncConsumer.handleBatchMessages([message]);
        } else {
          this.logger.warn(`[ROUTE: UNKNOWN] Format payload tidak dikenali: ${message.Body}`);
        }

      } catch (err: any) {
        this.logger.error(`[DISPATCHER ERROR] Gagal memproses pesan ID: ${message.MessageId}`, err.stack);
        throw err; // Trigger SQS Retry
      }
    }
  }
}