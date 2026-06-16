import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { CalendarMaterializerService } from '../services/calendar-materializer.service';
import { CalendarRepositoryService } from '../services/calendar-repository.service';
import { GoogleApiClientService } from '../services/google-api-client.service';
import { RateBuilder } from '../builders/rate.builder';
import { AvailabilityBuilder } from '../builders/availability.builder';
import { InventoryBuilder } from '../builders/inventory.builder';

@Processor('google-sync', { concurrency: 5 })
export class GooglePushConsumer extends WorkerHost {
  private readonly logger = new Logger(GooglePushConsumer.name);

  constructor(
    private readonly materializerService: CalendarMaterializerService,
    private readonly calendarRepo: CalendarRepositoryService,
    private readonly googleApiClient: GoogleApiClientService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { hotelCode, startDate, endDate } = job.data;
    this.logger.log(`Processing sync job ${job.id} for ${hotelCode} (${startDate} - ${endDate})`);

    try {
      // 1. Materialize the flat table
      await this.materializerService.materialize(hotelCode, startDate, endDate);

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

      // 5. If base data changed, we might also push a Transaction message, 
      // but typically we'd do that on a separate queue or specific base-data trigger.

      this.logger.log(`Completed sync job ${job.id} for ${hotelCode}`);
    } catch (error) {
      this.logger.error(`Failed sync job ${job.id} for ${hotelCode}`, error.stack);
      throw error; // Let BullMQ handle retry and backoff
    }
  }
}
