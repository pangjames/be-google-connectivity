import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GoogleSyncService } from './google-sync.service';
import { PropertySyncReferenceDto } from '../controllers/dtos/google-connectivity.dto';

@Injectable()
export class EventHandlerService {
  private readonly logger = new Logger(EventHandlerService.name);

  constructor(
    private readonly googleSyncService: GoogleSyncService,
    @InjectQueue('property-update-queue') private readonly propertyUpdateQueue: Queue,
  ) {}

  /**
   * Captures the unified ARI_CHANGE event (Rates & Restrictions) triggered by PMS modifications.
   * Eliminates dynamic JSON data dependencies by using strictly Thin Payload coordinates.
   * Downstream materializer will fetch and process the fresh states directly from 'tb_hotel_rate_custom'.
   */
  async handleAriChange(
    hotelCode: string,
    roomTypeId: number,
    ratePlanId: number,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    this.logger.log(
      `Detected ARI_CHANGE on master db for ${hotelCode} (Room: ${roomTypeId}, Rate Plan: ${ratePlanId}) from ${startDate} to ${endDate}`
    );

    // Instantly forward to the centralized sync service using strict date clamping & gatekeeper checks
    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1, // High priority for live pricing and availability changes
    });
  }

  /**
   * Handles real-time property delta updates from the extranet core system.
   * Dispatches the coordinate reference to BullMQ for Master DB fetching.
   */
  async handleExtranetDeltaUpdate(
    entityReference: PropertySyncReferenceDto,
    updateType: 'hotel' | 'room' | 'rate_plan' 
  ): Promise<void> {
    const { hotel_id } = entityReference;
    this.logger.log(`Queueing static sync trigger [${updateType.toUpperCase()}] for Hotel ID: ${hotel_id}`);
    
    const generatedJobId = `static-sync-${hotel_id}-${updateType}-${Date.now()}`;

    try {
      await this.propertyUpdateQueue.add(
        'sync-delta',
        { entityReference, updateType },
        {
          jobId: generatedJobId,
          priority: 3, // Lower priority than live price/restriction updates
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      this.logger.log(`Successfully dispatched job [${generatedJobId}] to property-update-queue`);
    } catch (error) {
      this.logger.error(`Failed to dispatch job for Hotel ID ${hotel_id} into BullMQ`, error.message);
      throw error;
    }
  }
}