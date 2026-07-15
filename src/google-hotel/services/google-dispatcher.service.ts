import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { PropertySyncConsumer } from '../consumers/property-sync.consumer';

@Injectable()
export class GoogleDispatcherService {
  private readonly logger = new Logger(GoogleDispatcherService.name);
  private sqsClient: SQSClient;
  private queueUrl: string;
  private readonly useMock: boolean;

  constructor(
    private configService: ConfigService,
    private readonly propertySyncConsumer: PropertySyncConsumer,
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
      this.queueUrl = this.configService.get<string>('AWS_SQS_PROPERTY_QUEUE_URL')!;
    }
  }

  /**
   * Fungsi untuk mengirim perintah sinkronisasi hotel ke AWS SQS FIFO
   */
  async dispatchSyncCommand(
    updateType: string,
    entityReference: { hotelId: any; roomId?: any; rateId?: any }
  ) {
    const hotelCode = entityReference.hotelId;

    if (this.useMock) {
      this.logger.log(`[SQS MOCK DISPATCH] Directly invoking PropertySyncConsumer for hotel: ${hotelCode}, type: ${updateType}`);
      const mockMessage = {
        Body: JSON.stringify({
          entityReference,
          updateType,
        }),
        MessageId: `mock-dispatch-${Date.now()}`,
      };
      setImmediate(async () => {
        try {
          await this.propertySyncConsumer.handleBatchMessages([mockMessage as any]);
        } catch (err) {
          this.logger.error(`[SQS MOCK ERROR] Failed to process mock dispatch for ${hotelCode}`, err);
        }
      });
      return;
    }

    try {
      // Membuat hash sederhana untuk deduplikasi pesan dalam 5 menit
      const deduplicationId = `${hotelCode}_${updateType}_${Date.now()}`;

      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ entityReference, updateType }),
        // MessageGroupId menjamin urutan FIFO aman per properti hotel
        MessageGroupId: String(hotelCode), 
        MessageDeduplicationId: deduplicationId,
      });

      await this.sqsClient.send(command);
      this.logger.log(`[SQS DISPATCH] Berhasil mengirim perintah untuk hotel: ${hotelCode}`);
    } catch (error) {
      this.logger.error(`[SQS ERROR] Gagal mengirim pesan ke SQS:`, error);
      throw error;
    }
  }
}