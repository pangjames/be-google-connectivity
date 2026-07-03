import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';
import { PropertyRepositoryService } from './property-repository.service';
import { GoogleApiClientService } from './google-api-client.service';
import { GoogleSyncService } from './google-sync.service';
import { GoogleStaticFeedBuilder } from '../builders/google-static-feed.builder';
import { PropertySyncReferenceDto } from '../controllers/dtos/google-connectivity.dto';

@Injectable()
export class GoogleConnectivityService {
  private readonly logger = new Logger(GoogleConnectivityService.name);

  constructor(
    @InjectRepository(HotelConnectivitySetup)
    private readonly setupRepo: Repository<HotelConnectivitySetup>,
    private readonly propertyRepo: PropertyRepositoryService,
    private readonly googleApiConnector: GoogleApiClientService,
    private readonly googleSyncService: GoogleSyncService,
  ) {}

  /**
   * Validates row data against Google XSD specifications.
   * Returns 1 if valid, 0 otherwise.
   */
  private validateGatekeeper(row: any): number {
    if (!row) return 0;

    // Hotel Profile Validation
    if (!row.hotel_code || !row.hotel_name || !row.street_address || !row.city || !row.province || !row.phone) {
      return 0;
    }
    // Geo-coordinates Validation
    if (!row.latitude || row.latitude === '0.0' || !row.longitude || row.longitude === '0.0') {
      return 0;
    }
    // Room Type Validation
    if (!row.room_type_id || !row.room_type_name || row.room_capacity <= 0) {
      return 0;
    }
    // Rate Plan Validation
    if (!row.rate_plan_id || !row.rate_plan_name) {
      return 0;
    }
    return 1;
  }

  /**
   * Processes entity reference, fetches fresh data, and pushes static updates to Google.
   */
  async handleExtranetDeltaUpdate(
    entityReference: PropertySyncReferenceDto,
    updateType: 'hotel' | 'room' | 'rate_plan'
  ): Promise<void> {
    const { hotel_id, room_type_id, rate_plan_id } = entityReference;
    
    this.logger.log(`Executing Read-DB-Sync for Hotel ID: ${hotel_id} [Scope: ${updateType.toUpperCase()}]`);

    // Fetch Fresh Data from Master DB
    let freshData: any = null;
    if (updateType === 'hotel') {
      freshData = await this.propertyRepo.getMasterHotel(hotel_id);
    } else if (updateType === 'room' && room_type_id) {
      freshData = await this.propertyRepo.getMasterRoom(room_type_id);
    } else if (updateType === 'rate_plan' && rate_plan_id) {
      freshData = await this.propertyRepo.getMasterRatePlan(rate_plan_id);
    }

    if (!freshData) {
      this.logger.warn(`Aborting sync. Target data not found in Master DB for Hotel ID: ${hotel_id}`);
      return;
    }

    // Gatekeeper Validation on FRESH data overlaying existing setup
    const existingSetup = await this.setupRepo.findOne({ where: { hotel_id } }) || {};
    const mergedContext = { ...existingSetup, ...freshData };
    const currentStatus = this.validateGatekeeper(mergedContext);

    // Update the local Setup Cache
    await this.setupRepo.save({
      ...mergedContext,
      setup_status: currentStatus,
    });

    // Trigger Static Data Push to Google if Valid
    if (currentStatus === 1) {
      const activeRows = await this.setupRepo.find({ where: { hotel_id, setup_status: 1 } });
      if (activeRows.length > 0) {
        const actualDbHotelCode = activeRows[0].hotel_code;
        
        const hotelListXml = GoogleStaticFeedBuilder.buildHotelListFeed(activeRows);
        const transactionXml = GoogleStaticFeedBuilder.buildTransactionMetadata(actualDbHotelCode, activeRows);

        await this.googleApiConnector.pushPayload(actualDbHotelCode, hotelListXml, 'HotelListFeed');
        await this.googleApiConnector.pushPayload(actualDbHotelCode, transactionXml, 'TransactionMetadata');
      }
    } else {
      this.logger.warn(`Property sync failed Gatekeeper validation for Hotel ID: ${hotel_id}. Status set to 0.`);
    }

    // CHAIN REACTION: Trigger Calendar Sync via Centralized Service
    if ((updateType === 'room' || updateType === 'rate_plan') && mergedContext.hotel_code) {
      this.logger.log(`Triggering domino calendar sync for ${mergedContext.hotel_code} via unified sync service.`);
      
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = new Date(new Date().setDate(new Date().getDate() + 365)).toISOString().split('T')[0];
      
      await this.googleSyncService.syncDateRange({
        hotelCode: mergedContext.hotel_code,
        startDate,
        endDate,
        priority: 2 
      });
    }
  }
}