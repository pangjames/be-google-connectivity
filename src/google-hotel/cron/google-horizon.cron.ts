import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../../common/entities/hotel.entity';
import { GoogleSyncService } from '../services/google-sync.service';
import { CalendarRepositoryService } from '../services/calendar-repository.service';

@Injectable()
export class GoogleHorizonCron {
  private readonly logger = new Logger(GoogleHorizonCron.name);

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepo: Repository<Hotel>,
    private readonly googleSyncService: GoogleSyncService,
    private readonly calendarRepo: CalendarRepositoryService,
  ) {}

  // Run nightly at 01:00 AM
  @Cron('0 1 * * *')
  async handleCron() {
    this.logger.log('Starting nightly Google Horizon Cron (365-day rolling window)');
    
    try {
      this.logger.log('Purging historical data before sync...');
      await this.calendarRepo.purgeHistoricalData();
    } catch (error) {
      this.logger.error('Failed to purge historical data', error.stack);
    }

    const activeHotels = await this.hotelRepo.find({ where: { status: 1 } });
    
    const today = new Date();
    const maxHorizon = new Date();
    maxHorizon.setDate(today.getDate() + 365);
    
    const startDate = today.toISOString().split('T')[0];
    const endDate = maxHorizon.toISOString().split('T')[0];

    const syncPromises = activeHotels.map(hotel => 
      this.googleSyncService.syncDateRange({
        hotelCode: hotel.code,
        startDate,
        endDate,
        priority: 10, // Low priority for nightly batch
      }).then(() => {
        this.logger.log(`Queued nightly horizon sync for ${hotel.code}`);
      }).catch(error => {
        this.logger.error(`Failed to queue nightly horizon sync for ${hotel.code}`, error.stack);
      })
    );

    await Promise.all(syncPromises);
    this.logger.log(`Completed queueing nightly sync for ${activeHotels.length} hotels.`);
  }
}
