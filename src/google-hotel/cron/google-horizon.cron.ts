import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';
import { GoogleSyncService } from '../services/google-sync.service';
import { CalendarRepositoryService } from '../services/calendar-repository.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleHorizonCron {
  private readonly logger = new Logger(GoogleHorizonCron.name);

  constructor(
    @InjectRepository(HotelConnectivitySetup, 'googleConnection') // <-- Diarahkan ke DB Google
    private readonly setupRepo: Repository<HotelConnectivitySetup>,
    private readonly googleSyncService: GoogleSyncService,
    private readonly calendarRepo: CalendarRepositoryService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('0 1 * * *')
  // @Cron('* * * * *')
  async handleCron() {
    this.logger.log('Starting nightly Google Horizon Cron (Rolling Horizon Extension)');
    
    try {
      this.logger.log('Purging historical data before sync...');
      await this.calendarRepo.purgeHistoricalData();
    } catch (error) {
      this.logger.error('Failed to purge historical data', error.stack);
    }

    const activeSetups = await this.setupRepo.createQueryBuilder('setup')
      .select('DISTINCT setup.hotel_code', 'hotel_code')
      .where('setup.setup_status = 1')
      .getRawMany();
    
    const activeHotels = activeSetups.map(s => ({ code: s.hotel_code }));
    
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
          startDate = today;
          this.logger.log(`Initial sync for ${hotel.code}. Horizon: ${maxHorizonMonths} months`);
        } else {
          if (currentMaxDate >= targetMaxDate) {
            this.logger.log(`Horizon already extended for ${hotel.code}. Skipping.`);
            return;
          }
          startDate = new Date(currentMaxDate);
          startDate.setDate(startDate.getDate() + 1);
        }

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = targetMaxDate.toISOString().split('T')[0];

        // PERBAIKAN: Mengirim 3 argumen sesuai dengan definisi service baru
        await this.googleSyncService.syncDateRange(hotel.code, startStr, endStr);
        
        this.logger.log(`Queued horizon sync for ${hotel.code}`);
      } catch (error) {
        this.logger.error(`Failed to process horizon sync for ${hotel.code}`, error.stack);
      }
    });

    await Promise.all(syncPromises);
    this.logger.log(`Completed nightly horizon extension for active hotels.`);
  }
}