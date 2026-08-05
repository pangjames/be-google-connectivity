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
      let payload: any;
      
      // 1. SAFE PARSING: Catch JSON formatting errors without triggering SQS retries
      try {
        payload = typeof message.Body === 'string' ? JSON.parse(message.Body) : message.Body;
      } catch (parseErr) {
        this.logger.warn(`[DISPATCHER SKIPPED] Invalid JSON payload in Message ID: ${message.MessageId}. Message discarded.`);
        continue; // Proceed to the next message; this message will be acknowledged/removed from the SQS queue
      }

      // 2. ROUTING LOGIC
      try {
        if (!payload) {
          this.logger.warn(`[DISPATCHER SKIPPED] Empty payload in Message ID: ${message.MessageId}`);
          continue;
        }

        if (payload.promotionId || payload.updateType === 'PROMOTION_UPDATE') {
          this.logger.log(`[ROUTE: PROMOTION] Message ID: ${message.MessageId} forwarded to PromotionSyncConsumer`);
          await this.promotionSyncConsumer.handleBatchMessages([message]);
        } else if (payload.entityReference) {
          this.logger.log(`[ROUTE: PROPERTY] Message ID: ${message.MessageId} forwarded to PropertySyncConsumer`);
          await this.propertySyncConsumer.handleBatchMessages([message]);
        } else if (payload.hotelCode) {
          this.logger.log(`[ROUTE: ARI] Message ID: ${message.MessageId} forwarded to GoogleAriSyncConsumer`);
          await this.googleAriSyncConsumer.handleBatchMessages([message]);
        } else {
          this.logger.warn(`[ROUTE: UNKNOWN] Unrecognized payload format: ${message.Body}`);
        }

      } catch (err: any) {
        this.logger.error(`[DISPATCHER ERROR] Failed to process Message ID: ${message.MessageId}`, err.stack);
        throw err; // Re-throw triggers an SQS Retry as the error stems from business logic or DB failure, NOT payload format
      }
    }
  }
}