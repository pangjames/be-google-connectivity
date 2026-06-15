import { Controller, Post, Body, Logger, InternalServerErrorException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LiveQueryRequestDto } from './dtos/sync-request.dto';
import { LiveQueryCacheService } from '../services/live-query-cache.service';
import { CalendarRepositoryService } from '../services/calendar-repository.service';
import { LiveQueryResponse } from '../interfaces/google-ari.interfaces';

@ApiTags('Public / Google Live Query')
@Controller('public/google-live-query')
export class LiveQueryController {
  private readonly logger = new Logger(LiveQueryController.name);

  constructor(
    private readonly cacheService: LiveQueryCacheService,
    private readonly calendarRepo: CalendarRepositoryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Live query endpoint for Google Hotel Pricing' })
  async getLiveQuery(@Body() dto: LiveQueryRequestDto) {
    const { hotelCode, checkIn, checkOut } = dto;
    const startTs = Date.now();

    // The 4000ms SLA Promise Race
    const timeoutGuard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SLA Timeout Exceeded')), 4000),
    );

    const queryLogic = async (): Promise<LiveQueryResponse> => {
      // 1. Check cache first
      const cached = await this.cacheService.getCachedResponse(hotelCode, checkIn, checkOut);
      if (cached) {
        this.logger.debug(`Live query cache HIT for ${hotelCode} (${Date.now() - startTs}ms)`);
        return cached;
      }

      // 2. Fetch from fast flat table if not in cache
      this.logger.debug(`Live query cache MISS for ${hotelCode}, querying DB...`);
      const inventories = await this.calendarRepo.getInventoriesForDateRange(hotelCode, checkIn, checkOut);

      // Aggregate inventories into response (simplified mapping)
      const options = inventories.map(inv => ({
        roomTypeCode: inv.room_type_id.toString(),
        ratePlanCode: inv.rate_plan_id.toString(),
        totalAmountAfterTax: inv.amount_after_tax,
        available: inv.inv_count > 0 && inv.restriction_master !== 'Close',
      }));

      const response: LiveQueryResponse = {
        hotelCode,
        checkIn,
        checkOut,
        options,
      };

      // 3. Set cache asynchronously
      this.cacheService.setCachedResponse(hotelCode, checkIn, checkOut, response).catch(e => {
        this.logger.error('Failed to set cache in background', e);
      });

      return response;
    };

    try {
      const result = await Promise.race([queryLogic(), timeoutGuard]);
      
      const duration = Date.now() - startTs;
      if (duration > 3000) {
        this.logger.warn(`Live query SLA warning: Request for ${hotelCode} took ${duration}ms`);
      }

      return result;
    } catch (error) {
      if (error.message === 'SLA Timeout Exceeded') {
        this.logger.error(`Live query SLA FAILED: Request for ${hotelCode} exceeded 4000ms`);
        // We still need to return something or fail. Google might prefer a quick fail over a slow response.
      }
      throw new InternalServerErrorException(error.message);
    }
  }
}
