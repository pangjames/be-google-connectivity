import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../../common/entities/hotel.entity';
import { GoogleSyncService } from '../services/google-sync.service';

@Injectable()
export class GoogleHorizonCron {
  private readonly logger = new Logger(GoogleHorizonCron.name);

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepo: Repository<Hotel>,
    private readonly googleSyncService: GoogleSyncService,
  ) {}

  // Run nightly at 01:00 AM
  @Cron('0 1 * * *')
  async handleCron() {
    this.logger.log('Starting nightly Google Horizon Cron (365-day rolling window)');
    
    // In a real scenario, you'd only sync active hotels pushing to Google
    const activeHotels = await this.hotelRepo.find({ where: { status: 1 } });
    
    const today = new Date();
    const maxHorizon = new Date();
    maxHorizon.setDate(today.getDate() + 365);
    
    const startDate = today.toISOString().split('T')[0];
    const endDate = maxHorizon.toISOString().split('T')[0];

    for (const hotel of activeHotels) {
      try {
        await this.googleSyncService.syncDateRange({
          hotelCode: hotel.code,
          startDate,
          endDate,
        });
        this.logger.log(`Queued nightly horizon sync for ${hotel.code}`);
      } catch (error) {
        this.logger.error(`Failed to queue nightly horizon sync for ${hotel.code}`, error.stack);
      }
    }
  }
}
