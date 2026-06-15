import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SyncDateRangeOptions } from '../interfaces/google-ari.interfaces';

@Injectable()
export class GoogleSyncService {
  private readonly logger = new Logger(GoogleSyncService.name);

  constructor(
    @InjectQueue('google-sync') private syncQueue: Queue,
  ) {}

  /**
   * The unified entry point for syncing ARI to Google.
   */
  async syncDateRange(options: SyncDateRangeOptions) {
    const { hotelCode, startDate, endDate } = this.clampDateRange(options);

    // Deterministic Job ID to avoid chittering (duplicate jobs within a small window)
    const jobId = `sync:${hotelCode}:${startDate}:${endDate}`;

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
    };
  }
}
