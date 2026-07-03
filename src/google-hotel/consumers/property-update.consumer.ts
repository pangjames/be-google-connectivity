import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
// @ts-ignore
import Redlock from 'redlock';
import { GoogleConnectivityService } from '../services/google-connectivity.service';

@Processor('property-update-queue', { 
  concurrency: 5,
  limiter: { max: 10, duration: 1000 }
})
export class PropertyUpdateConsumer extends WorkerHost {
  private readonly logger = new Logger(PropertyUpdateConsumer.name);
  private readonly redisClient: Redis;
  private readonly redlock: Redlock;

  constructor(
    private readonly connectivityService: GoogleConnectivityService,
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
    const { entityReference, updateType } = job.data;
    const hotelId = entityReference?.hotel_id;
    
    this.logger.log(`Processing property update job ${job.id} for Hotel ID ${hotelId}`);

    let lock: any;
    try {
      // 1. Acquire Distributed Lock to prevent overlapping updates on the same property
      lock = await this.redlock.acquire([`locks:property-sync:${hotelId}`], 10000);
      
      // 2. Delegate business logic to the connectivity service
      await this.connectivityService.handleExtranetDeltaUpdate(entityReference, updateType);
      
      this.logger.log(`Successfully completed property update job ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed property update job ${job.id} for Hotel ID ${hotelId}`, error.stack);
      throw error; 
    } finally {
      // 3. Release lock to free up the property resource
      if (lock && typeof lock.release === 'function') {
        await lock.release().catch((e: Error) => 
          this.logger.error(`Failed to release distributed lock for Hotel ID ${hotelId}`, e.stack)
        );
      }
    }
  }
}