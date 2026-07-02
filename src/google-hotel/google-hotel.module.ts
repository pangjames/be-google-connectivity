import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Hotel } from '../common/entities/hotel.entity';
import { HotelRoomType } from '../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../common/entities/hotel-rate-plan.entity';
import { HotelRateCustom } from '../common/entities/hotel-rate-custom.entity';
import { HotelCalendarInventory } from '../common/entities/hotel-calendar-inventory.entity';
import { HotelConnectivitySetup } from '../common/entities/hotel-connectivity-setup.entity';

import { CalendarMaterializerService } from './services/calendar-materializer.service';
import { CalendarRepositoryService } from './services/calendar-repository.service';
import { GoogleApiClientService } from './services/google-api-client.service';
import { GoogleSyncService } from './services/google-sync.service';
import { EventHandlerService } from './services/event-handler.service';
import { GoogleConnectivityService } from './services/google-connectivity.service';

import { GooglePushConsumer } from './consumers/google-push.consumer';
import { GoogleHorizonCron } from './cron/google-horizon.cron';
import { PropertyUpdateConsumer } from './consumers/property-update.consumer';

import { GoogleSyncController } from './controllers/google-sync.controller';
import { PmsWebhookController } from './controllers/pms-webhook.controller';
import { GoogleConnectivityController } from './controllers/google-connectivity.controller';
import { MockGoogleApiController } from './controllers/mock-google-api.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Hotel,
      HotelRoomType,
      HotelRatePlan,
      HotelRateCustom,
      HotelCalendarInventory,
      HotelConnectivitySetup,
    ]),
    BullModule.registerQueue(
      {
        name: 'google-sync',
      },
      {
        name: 'property-update-queue',
      },
    ),
  ],
  controllers: [GoogleSyncController, PmsWebhookController,GoogleConnectivityController,MockGoogleApiController],
  providers: [
    CalendarMaterializerService,
    CalendarRepositoryService,
    GoogleApiClientService,
    GoogleSyncService,
    GoogleConnectivityService,
    EventHandlerService,
    GooglePushConsumer,
    PropertyUpdateConsumer,
    GoogleHorizonCron,
  ],
  exports: [GoogleConnectivityService],
})
export class GoogleHotelModule {}
