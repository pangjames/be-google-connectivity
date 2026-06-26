import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../../common/entities/hotel.entity';
import { GoogleSyncService } from '../services/google-sync.service';
import { CalendarRepositoryService } from '../services/calendar-repository.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleHorizonCron {
  private readonly logger = new Logger(GoogleHorizonCron.name);

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepo: Repository<Hotel>,
    private readonly googleSyncService: GoogleSyncService,
    private readonly calendarRepo: CalendarRepositoryService,
    private readonly configService: ConfigService,
  ) {}

  // Run nightly at 01:00 AM
  @Cron('0 1 * * *')
  async handleCron() {
    this.logger.log('Starting nightly Google Horizon Cron (Rolling Horizon Extension)');
    
    try {
      this.logger.log('Purging historical data before sync...');
      await this.calendarRepo.purgeHistoricalData();
    } catch (error) {
      this.logger.error('Failed to purge historical data', error.stack);
    }

    const activeHotels = await this.hotelRepo.createQueryBuilder('hotel')
      .innerJoin(
        'tb_hotel_connectivity_setup', 
        'setup', 
        'setup.hotel_code = hotel.code AND setup.setup_status = 1'
      )
      .where('hotel.status = 1')
      .select(['hotel.code'])
      .getMany();
    
    const horizonMonths = parseInt(this.configService.get('ROLLING_HORIZON_MONTHS', '3'), 10);
    const maxHorizonMonths = Math.min(horizonMonths, 12);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const targetMaxDate = new Date(today);
    targetMaxDate.setMonth(today.getMonth() + maxHorizonMonths);

    const syncPromises = activeHotels.map(async (hotel) => {
      try {
        const currentMaxDate = await this.calendarRepo.getMaxDate(hotel.code);
        
        let startDate: Date;
        if (!currentMaxDate) {
          // Initial sync
          startDate = today;
          this.logger.log(`Initial sync for ${hotel.code} (No data). Horizon: ${maxHorizonMonths} months`);
        } else {
          // Rolling extension
          if (currentMaxDate >= targetMaxDate) {
            this.logger.log(`Horizon already extended for ${hotel.code}. Skipping.`);
            return;
          }
          startDate = new Date(currentMaxDate);
          startDate.setDate(startDate.getDate() + 1);
          this.logger.log(`Extending horizon for ${hotel.code} from ${startDate.toISOString().split('T')[0]} to ${targetMaxDate.toISOString().split('T')[0]}`);
        }

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = targetMaxDate.toISOString().split('T')[0];

        await this.googleSyncService.syncDateRange({
          hotelCode: hotel.code,
          startDate: startStr,
          endDate: endStr,
          priority: 10, // Low priority for nightly batch
        });
        
        this.logger.log(`Queued horizon sync for ${hotel.code}`);
      } catch (error) {
        this.logger.error(`Failed to process horizon sync for ${hotel.code}`, error.stack);
      }
    });

    await Promise.all(syncPromises);
    this.logger.log(`Completed nightly horizon extension for active hotels.`);
  }
}
