import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SqsModule } from '@ssut/nestjs-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { TypeOrmModule } from '@nestjs/typeorm';

// Import Entities (Sesuaikan dengan yang digunakan di Service/Repository)
import { Hotel } from '../common/entities/hotel.entity';
import { HotelCalendarInventory } from '../common/entities/hotel-calendar-inventory.entity';
import { HotelRoomType } from '../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../common/entities/hotel-rate-plan.entity';
import { HotelPromotion } from '../common/entities/hotel-promotion.entity';

// Import Consumers
import { GoogleAriSyncConsumer } from './consumers/google-ari-sync.consumer';
import { PropertySyncConsumer } from './consumers/property-sync.consumer';

// Import Services
import { PropertyMaterializerService } from './services/property-materializer.service';
import { CalendarMaterializerService } from './services/calendar-materializer.service';
import { CalendarRepositoryService } from './services/calendar-repository.service';
import { GoogleApiService } from './services/google-api.service';
import { GoogleDispatcherService } from './services/google-dispatcher.service';
import { PromotionMaterializerService } from './services/promotion-materializer.service';
import { PromotionRepositoryService } from './services/promotion-repository.service';
import { PropertyRepositoryService } from './services/property-repository.service';
import { GoogleSyncService } from './services/google-sync.service';
import { GoogleHorizonCron } from './cron/google-horizon.cron';
import { MockGoogleApiController } from './controllers/mock-google-api.controller';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forFeature([
      Hotel, 
      HotelCalendarInventory, 
      HotelRoomType, 
      HotelRatePlan, 
      HotelPromotion
    ]),
    SqsModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const useMock = configService.get<string>('USE_MOCK_SQS') === 'true' || configService.get<string>('USE_SQS_MOCK') === 'true';
        if (useMock) {
          return {
            consumers: [],
            producers: [],
          };
        }

        const sqsClient = new SQSClient({
          region: configService.get<string>('AWS_REGION')!, 
          credentials: {
            accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID')!,
            secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
          },
        });

        return {
          consumers: [
            {
              name: 'google-sync-queue.fifo',
              queueUrl: configService.get<string>('AWS_SQS_SYNC_QUEUE_URL')!, 
              sqs: sqsClient,
              batchSize: 5,
              waitTimeSeconds: 20,
              suppressFifoWarning: true,
            },
            {
              name: 'property-sync-queue.fifo',
              queueUrl: configService.get<string>('AWS_SQS_PROPERTY_QUEUE_URL')!,
              sqs: sqsClient,
              batchSize: 5,
              waitTimeSeconds: 20,
              suppressFifoWarning: true,
            }
          ],
          producers: [], 
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [MockGoogleApiController], 
  providers: [
    GoogleAriSyncConsumer,
    PropertySyncConsumer,
    PropertyMaterializerService,            
    CalendarMaterializerService,
    CalendarRepositoryService,
    GoogleApiService,           
    PromotionMaterializerService,
    PromotionRepositoryService,
    PropertyRepositoryService,
    GoogleDispatcherService,          
    GoogleSyncService,
    GoogleHorizonCron,
  ],
})
export class GoogleHotelModule {}