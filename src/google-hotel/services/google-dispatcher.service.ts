import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GoogleDispatcherConsumer } from '../consumers/google-dispatcher.consumer';

@Injectable()
export class GoogleDispatcherService {
  private readonly logger = new Logger(GoogleDispatcherService.name);
  private sqsClient: SQSClient;
  private queueUrl: string;
  private readonly useMock: boolean;

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => GoogleDispatcherConsumer))
    private readonly googleDispatcherConsumer: GoogleDispatcherConsumer,
  ) {
    this.useMock = this.configService.get<string>('USE_MOCK_SQS') === 'true' || this.configService.get<string>('USE_SQS_MOCK') === 'true';
    if (!this.useMock) {
      // Inisialisasi AWS SQS Client untuk mengirim pesan
      this.sqsClient = new SQSClient({
        region: this.configService.get<string>('AWS_REGION')!,
        credentials: {
          accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
          secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
        },
      });
      this.queueUrl = this.configService.get<string>('AWS_SQS_CONNECTIVITY_QUEUE_URL')!;
    }
  }

  /**
   * Send a promotion synchronization command to AWS SQS FIFO
   */
  async dispatchSyncCommand(
    updateType: string,
    entityReference: { hotelId: any; roomId?: any; rateId?: any }
  ) {
    const hotelCode = entityReference.hotelId;

    if (this.useMock) {
      this.logger.log(`[SQS MOCK DISPATCH] Directly invoking GoogleDispatcherConsumer for hotel: ${hotelCode}, type: ${updateType}`);
      const mockMessage = {
        Body: JSON.stringify({
          entityReference,
          updateType,
        }),
        MessageId: `mock-dispatch-${Date.now()}`,
      };
      setImmediate(async () => {
        try {
          await this.googleDispatcherConsumer.handleBatchMessages([mockMessage as any]);
        } catch (err) {
          this.logger.error(`[SQS MOCK ERROR] Failed to process mock dispatch for ${hotelCode}`, err);
        }
      });
      return;
    }

    try {
      const deduplicationId = `${hotelCode}_${updateType}_${Date.now()}`;

      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ entityReference, updateType }),
      });

      await this.sqsClient.send(command);
      this.logger.log(`[SQS DISPATCH] Berhasil mengirim perintah untuk hotel: ${hotelCode}`);
    } catch (error) {
      this.logger.error(`[SQS ERROR] Gagal mengirim pesan ke SQS:`, error);
      throw error;
    }
  }

  /**
   * Fungsi untuk mengirim perintah sinkronisasi promosi ke AWS SQS FIFO
   */
  async dispatchPromotionCommand(
    hotelId: string | number | null | undefined,
    promotionId: number,
    action?: string,
    hotelCode?: string
  ) {
    const payload = { 
      entityReference: {
        hotelId,
        hotelCode,
        promotionId,
        action
      },
      updateType: 'PROMOTION_UPDATE' 
    };

    if (this.useMock) {
      this.logger.log(`[SQS MOCK DISPATCH] Directly invoking GoogleDispatcherConsumer for promo ID: ${promotionId}`);
      const mockMessage = {
        Body: JSON.stringify(payload),
        MessageId: `mock-dispatch-promo-${Date.now()}`,
      };
      setImmediate(async () => {
        try {
          await this.googleDispatcherConsumer.handleBatchMessages([mockMessage as any]);
        } catch (err) {
          this.logger.error(`[SQS MOCK ERROR] Failed to process mock promotion dispatch for promo ${promotionId}`, err);
        }
      });
      return;
    }

    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(payload),
      });

      await this.sqsClient.send(command);
      this.logger.log(`[SQS DISPATCH] Promotion sync queued for promo: ${promotionId}`);
    } catch (error) {
      this.logger.error(`[SQS ERROR] Gagal mengirim pesan promo ke SQS:`, error);
      throw error;
    }
  }
}