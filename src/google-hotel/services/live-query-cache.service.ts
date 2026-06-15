import { Injectable, Logger } from '@nestjs/common';

import Redis from 'ioredis';
import { LiveQueryResponse } from '../interfaces/google-ari.interfaces';

@Injectable()
export class LiveQueryCacheService {
  private readonly logger = new Logger(LiveQueryCacheService.name);
  private readonly TTL_SECONDS = 3600; // 1 hour

  // We are using ioredis directly, or via module. Since we didn't setup nestjs-redis yet,
  // we can use standard redis client or the one from bullmq.
  // For simplicity here, we'll instantiate a simple Redis client.
  private redisClient: Redis;

  constructor() {
    // In a real app, inject this properly using @nestjs-modules/ioredis
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  private getCacheKey(hotelCode: string, checkIn: string, checkOut: string): string {
    return `livequery:${hotelCode}:${checkIn}:${checkOut}`;
  }

  async getCachedResponse(hotelCode: string, checkIn: string, checkOut: string): Promise<LiveQueryResponse | null> {
    const key = this.getCacheKey(hotelCode, checkIn, checkOut);
    try {
      const data = await this.redisClient.get(key);
      if (data) {
        return JSON.parse(data) as LiveQueryResponse;
      }
    } catch (error) {
      this.logger.error('Failed to get from cache', error);
    }
    return null;
  }

  async setCachedResponse(hotelCode: string, checkIn: string, checkOut: string, response: LiveQueryResponse): Promise<void> {
    const key = this.getCacheKey(hotelCode, checkIn, checkOut);
    try {
      await this.redisClient.setex(key, this.TTL_SECONDS, JSON.stringify(response));
    } catch (error) {
      this.logger.error('Failed to set cache', error);
    }
  }

  async invalidateHotelCache(hotelCode: string): Promise<void> {
    // Invalidate all live queries for this hotel
    try {
      const keys = await this.redisClient.keys(`livequery:${hotelCode}:*`);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
        this.logger.log(`Invalidated ${keys.length} cache keys for hotel ${hotelCode}`);
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate cache for ${hotelCode}`, error);
    }
  }
}
