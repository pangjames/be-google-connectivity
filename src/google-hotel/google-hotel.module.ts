import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Hotel } from '../common/entities/hotel.entity';
import { HotelRoomType } from '../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../common/entities/hotel-rate-plan.entity';
import { HotelRateCustom } from '../common/entities/hotel-rate-custom.entity';
import { HotelCalendarInventory } from '../common/entities/hotel-calendar-inventory.entity';

import { CalendarMaterializerService } from './services/calendar-materializer.service';
import { CalendarRepositoryService } from './services/calendar-repository.service';
import { GoogleApiClientService } from './services/google-api-client.service';
import { GoogleSyncService } from './services/google-sync.service';

import { GooglePushConsumer } from './consumers/google-push.consumer';
import { GoogleHorizonCron } from './cron/google-horizon.cron';

import { GoogleSyncController } from './controllers/google-sync.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Hotel,
      HotelRoomType,
      HotelRatePlan,
      HotelRateCustom,
      HotelCalendarInventory,
    ]),
    BullModule.registerQueue({
      name: 'google-sync',
    }),
  ],
  controllers: [GoogleSyncController],
  providers: [
    CalendarMaterializerService,
    CalendarRepositoryService,
    GoogleApiClientService,
    GoogleSyncService,
    GooglePushConsumer,
    GoogleHorizonCron,
  ],
})
export class GoogleHotelModule {}
