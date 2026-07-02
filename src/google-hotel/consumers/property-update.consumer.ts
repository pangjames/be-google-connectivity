import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GoogleConnectivityService } from '../services/google-connectivity.service';

@Processor('property-update-queue')
export class PropertyUpdateConsumer extends WorkerHost {
  private readonly logger = new Logger(PropertyUpdateConsumer.name);

  constructor(
    private readonly googleConnectivityService: GoogleConnectivityService,
  ) {
    super();
  }

  /**
   * Processes data sync jobs from property-update-queue asynchronously.
   */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing background job ${job.id} of type ${job.name}`);

    switch (job.name) {
      case 'sync-delta': {
        const { flatDataFromDatabase, updateType } = job.data;
        
        // Execute the background database and XML sync logic
        await this.googleConnectivityService.handleExtranetDeltaUpdate(
          flatDataFromDatabase,
          updateType,
        );
        break;
      }

      default:
        this.logger.warn(`Unknown job name ${job.name} found in property update queue`);
    }
  }
}