import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GoogleAriSyncConsumer } from '../consumers/google-ari-sync.consumer';

@Injectable()
export class GoogleSyncService {
  private readonly logger = new Logger(GoogleSyncService.name);
  private sqsClient: SQSClient;
  private readonly useMock: boolean;

  constructor(
    private configService: ConfigService,
    private readonly googleAriSyncConsumer: GoogleAriSyncConsumer,
  ) {
    this.useMock = this.configService.get<string>('USE_MOCK_SQS') === 'true' || this.configService.get<string>('USE_SQS_MOCK') === 'true';
    if (!this.useMock) {
      this.sqsClient = new SQSClient({
        region: this.configService.get<string>('AWS_REGION')!,
        credentials: {
          accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
          secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
        },
      });
    }
  }

  async syncDateRange(
    hotelCode: string, 
    startDate: string, 
    endDate: string, 
    roomId?: number, 
    rateId?: number,
    updateType: string = 'FULL_SYNC'
  ) {
    const payload = { hotelCode, startDate, endDate, roomId, rateId, updateType };

    if (this.useMock) {
      this.logger.log(`[SQS MOCK SYNC] Triggering sync for ${hotelCode} | Type: ${updateType}`);
      const mockMessage = {
        Body: JSON.stringify(payload),
        MessageId: `mock-${Date.now()}`,
      };
      setImmediate(async () => {
        try {
          await this.googleAriSyncConsumer.handleBatchMessages([mockMessage as any]);
        } catch (err) {
          this.logger.error(`[SQS MOCK ERROR] Failed mock message for ${hotelCode}`, err);
        }
      });
      return;
    }

    const command = new SendMessageCommand({
      QueueUrl: this.configService.get('AWS_SQS_SYNC_QUEUE_URL')!,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: hotelCode, // Tetap gunakan hotelCode untuk jaminan antrean per hotel
      MessageDeduplicationId: `${hotelCode}-${startDate}-${endDate}-${roomId || 0}-${rateId || 0}-${Date.now()}`,
    });

    await this.sqsClient.send(command);
    this.logger.log(`Sync queued for ${hotelCode} (SQS) - Type: ${updateType}`);
  }
}