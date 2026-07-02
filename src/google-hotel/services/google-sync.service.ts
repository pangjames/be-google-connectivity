import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';
import { SyncDateRangeOptions } from '../interfaces/google-ari.interfaces';

@Injectable()
export class GoogleSyncService {
  private readonly logger = new Logger(GoogleSyncService.name);

  constructor(
    @InjectQueue('google-sync') private syncQueue: Queue,
    @InjectRepository(HotelConnectivitySetup)
    private readonly setupRepo: Repository<HotelConnectivitySetup>
  ) {}

  /**
   * The unified entry point for syncing ARI to Google.
   */
  async syncDateRange(options: SyncDateRangeOptions) {
    // Gatekeeper Action: Abort if static configuration is invalid or incomplete
    const activeSetup = await this.setupRepo.findOne({
      where: { hotel_code: options.hotelCode, setup_status: 1 }
    });

    if (!activeSetup) {
      this.logger.warn(`Sync skipped for ${options.hotelCode} due to invalid static setup_status`);
      return { message: 'Sync aborted. Property data structure is invalid or incomplete.', status: 'blocked' };
    }

    // Deterministic Job ID to avoid chittering (duplicate jobs within a small window)
    const { hotelCode, startDate, endDate } = this.clampDateRange(options);
    const jobId = `sync-${hotelCode}-${startDate}-${endDate}`;

    this.logger.log(`Queueing sync for ${hotelCode} from ${startDate} to ${endDate}`);

    await this.syncQueue.add(
      'push-ari',
      {
        hotelCode,
        startDate,
        endDate,
      },
      {
        jobId,
        priority: options.priority || 5, // Default to 5
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    );

    return { message: 'Sync job queued successfully', jobId };
  }

  /**
   * Enforces the 365-day rolling window limit.
   */
  private clampDateRange(options: SyncDateRangeOptions): SyncDateRangeOptions {
    const start = new Date(options.startDate);
    const end = new Date(options.endDate);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const maxHorizon = new Date(today);
    maxHorizon.setDate(today.getDate() + 365);

    let finalStart = start;
    let finalEnd = end;

    if (start < today) {
      finalStart = today;
    }
    
    if (end > maxHorizon) {
      finalEnd = maxHorizon;
    }

    return {
      hotelCode: options.hotelCode,
      startDate: finalStart.toISOString().split('T')[0],
      endDate: finalEnd.toISOString().split('T')[0],
      priority: options.priority,
    };
  }
}
