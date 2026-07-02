import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { GoogleSyncService } from './google-sync.service';
import { GoogleConnectivityService } from './google-connectivity.service';

@Injectable()
export class EventHandlerService {
  private readonly logger = new Logger(EventHandlerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly googleSyncService: GoogleSyncService,
    private readonly googleGatekeeper: GoogleConnectivityService,
    @InjectQueue('property-update-queue') private readonly propertyUpdateQueue: Queue,
  ) {}

  /**
   * Captures the RATE_CHANGE event triggered by Extranet modifications.
   * Parameter 'newRate' is preserved to prevent compiler breaking, but no DB write is performed.
   * Downstream materializer will read the updated state from 'tb_hotel_rate_custom'.
   */
  async handleRateChange(
    hotelCode: string,
    roomTypeId: number,
    ratePlanId: number,
    startDate: string,
    endDate: string,
    newRate: number, 
  ): Promise<void> {
    this.logger.log(
      `Detected RATE_CHANGE on master db for ${hotelCode} (Room: ${roomTypeId}, Rate Plan: ${ratePlanId}) from ${startDate} to ${endDate}. New Rate Payload: ${newRate}`
    );

    // Langsung lempar ke antrean sync Google tanpa melakukan query INSERT/UPDATE
    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1,
    });
  }

  /**
   * Captures the RESTRICTION_CHANGE event from Extranet.
   * Parameter 'isOpen' is preserved to maintain contract with the controller payload.
   * Data integrity relies on the core database master change.
   */
  async handleRestrictionChange(
    hotelCode: string,
    roomTypeId: number,
    ratePlanId: number,
    startDate: string,
    endDate: string,
    isOpen: boolean, 
    restrictionType: 'master' | 'arrival' | 'departure' = 'master',
  ): Promise<void> {
    this.logger.log(
      `Detected RESTRICTION_CHANGE [${restrictionType.toUpperCase()}] for ${hotelCode} (Room: ${roomTypeId}, Rate Plan: ${ratePlanId}) from ${startDate} to ${endDate}. Is Open: ${isOpen}`
    );

    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1,
    });
  }

  /**
   * Handles real-time property delta updates from the extranet core system.
   * Dispatches the task to BullMQ with strict job options and exponential backoff.
   */
  async handleExtranetDeltaUpdate(
    flatDataFromDatabase: any[],
    updateType: 'hotel' | 'room' | 'rate_plan' 
  ): Promise<void> {
    const targetHotelId = flatDataFromDatabase[0]?.hotel_id ?? 'Unknown';
    this.logger.log(`Queueing automated data change event [${updateType.toUpperCase()}] for Hotel ID: ${targetHotelId}`);
    
    const generatedJobId = `static-sync-${targetHotelId}-${updateType}-${Date.now()}`;

    try {
      await this.propertyUpdateQueue.add(
        'sync-delta',
        {
          flatDataFromDatabase,
          updateType,
        },
        {
          jobId: generatedJobId,
          priority: 3,
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
      this.logger.error(`Failed to dispatch job for Hotel ID ${targetHotelId} into BullMQ`, error.message);
      throw error;
    }
  }
}