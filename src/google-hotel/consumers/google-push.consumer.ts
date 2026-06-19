import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { CalendarMaterializerService } from '../services/calendar-materializer.service';
import { CalendarRepositoryService } from '../services/calendar-repository.service';
import { GoogleApiClientService } from '../services/google-api-client.service';
import { RateBuilder } from '../builders/rate.builder';
import { AvailabilityBuilder } from '../builders/availability.builder';
import { InventoryBuilder } from '../builders/inventory.builder';
import Redis from 'ioredis';
// @ts-ignore
import Redlock from 'redlock';

// Rate Limiter: max 10 jobs per 1000ms (1 second) to prevent Google API rate limits
@Processor('google-sync', { 
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  }
})
export class GooglePushConsumer extends WorkerHost {
  private readonly logger = new Logger(GooglePushConsumer.name);
  private readonly redisClient: Redis;
  private readonly redlock: Redlock;

  constructor(
    private readonly materializerService: CalendarMaterializerService,
    private readonly calendarRepo: CalendarRepositoryService,
    private readonly googleApiClient: GoogleApiClientService,
  ) {
    super();
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
    this.redlock = new Redlock([this.redisClient as any], {
      driftFactor: 0.01,
      retryCount: 5,
      retryDelay: 200,
      retryJitter: 200,
    });
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { hotelCode, startDate, endDate } = job.data;
    this.logger.log(`Processing sync job ${job.id} for ${hotelCode} (${startDate} - ${endDate})`);

    try {
      // 1. Materialize the flat table with Distributed Locking (prevent Race Condition)
      let lock: any;
      try {
        // Lock for 10 seconds
        lock = await this.redlock.acquire([`locks:hotel-materialize:${hotelCode}`], 10000);
        await this.materializerService.materialize(hotelCode, startDate, endDate);
      } catch (err) {
        this.logger.error(`Failed to acquire lock for materializing ${hotelCode}`, err.stack);
        throw err; // Trigger retry
      } finally {
        if (lock && typeof lock.release === 'function') {
          await lock.release().catch((e: Error) => this.logger.error(`Failed to release lock for ${hotelCode}`, e.stack));
        }
      }

      // 2. Fetch the flat table data
      const inventories = await this.calendarRepo.getInventoriesForDateRange(hotelCode, startDate, endDate);
      
      if (!inventories || inventories.length === 0) {
        this.logger.warn(`No inventory data found for ${hotelCode} in the specified date range.`);
        return;
      }

      // 3. Build XML Payloads
      const ratePayload = RateBuilder.buildRateAmountNotifRQ(hotelCode, inventories);
      const availPayload = AvailabilityBuilder.buildAvailNotifRQ(hotelCode, inventories);
      const invPayload = InventoryBuilder.buildInvCountNotifRQ(hotelCode, inventories);

      // 4. Push to Google API (Wait for success, or let it throw and retry)
      await this.googleApiClient.pushPayload(hotelCode, ratePayload, 'RateAmount');
      await this.googleApiClient.pushPayload(hotelCode, availPayload, 'Availability');
      await this.googleApiClient.pushPayload(hotelCode, invPayload, 'Inventory');

      this.logger.log(`Completed sync job ${job.id} for ${hotelCode}`);
    } catch (error) {
      this.logger.error(`Failed sync job ${job.id} for ${hotelCode}`, error.stack);
      throw error; // Let BullMQ handle retry and backoff
    }
  }
}
