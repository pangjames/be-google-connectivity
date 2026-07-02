import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';
import { GoogleStaticFeedBuilder } from '../builders/google-static-feed.builder';
import { GoogleApiClientService } from './google-api-client.service';

@Injectable()
export class GoogleConnectivityService {
  private readonly logger = new Logger(GoogleConnectivityService.name);

  constructor(
    @InjectRepository(HotelConnectivitySetup)
    private readonly setupRepo: Repository<HotelConnectivitySetup>,
    private readonly googleApiConnector: GoogleApiClientService,
  ) {}

  /**
   * Validates row data against Google XSD specifications.
   * Returns 1 if valid, 0 otherwise.
   */
  validateGatekeeper(row: any): number {
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
   * Processes partial data updates from Extranet and syncs with Google if valid.
   */
  async handleExtranetDeltaUpdate(
    payloadData: any[], 
    updateType: 'hotel' | 'room' | 'rate_plan'
  ): Promise<void> {
    
    // Protect against empty payload data
    if (!payloadData || !Array.isArray(payloadData) || payloadData.length === 0) {
      this.logger.error('Aborting delta sync. Payload data is empty or invalid.');
      return;
    }

    // Extract hotel_id from the first row of payload data to act as the relational database anchor
    const targetHotelId = payloadData[0]?.hotel_id;

    if (!targetHotelId) {
      this.logger.error('Aborting delta sync. No valid hotel_id found in payload data.');
      return;
    }

    this.logger.log(`Processing delta sync for Hotel ID: ${targetHotelId}`);

    for (const incomingRow of payloadData) {
      
      // Filter out undefined fields from partial update payload
      const cleanIncomingData = Object.fromEntries(
        Object.entries(incomingRow).filter(([_, v]) => v !== undefined)
      );

      // Fetch existing database rows based on the update scope
      let existingRows: HotelConnectivitySetup[] = [];

      if (updateType === 'hotel') {
        existingRows = await this.setupRepo.find({ where: { hotel_id: targetHotelId } });
      } else if (updateType === 'room') {
        existingRows = await this.setupRepo.find({ 
          where: { hotel_id: targetHotelId, room_type_id: incomingRow.room_type_id } 
        });
      } else if (updateType === 'rate_plan') {
        existingRows = await this.setupRepo.find({ 
          where: { 
            hotel_id: targetHotelId, 
            room_type_id: incomingRow.room_type_id, 
            rate_plan_id: incomingRow.rate_plan_id 
          } 
        });
      }

      // Handle CREATE action if no existing rows are found
      if (existingRows.length === 0) {
        const currentStatus = this.validateGatekeeper(incomingRow);
        await this.setupRepo.save({
          ...incomingRow,
          setup_status: currentStatus
        });
        continue;
      }

      // Handle UPDATE action by merging clean incoming fields into existing records
      for (const oldRow of existingRows) {
        const mergedRow = {
          ...oldRow,
          ...cleanIncomingData, 
        };

        // Re-evaluate data integrity status after merge
        mergedRow.setup_status = this.validateGatekeeper(mergedRow);

        // Commit changes to database
        await this.setupRepo.save(mergedRow);
      }
    }

    // Global Re-validation: Fetch all currently active live rows based on master numeric hotel_id
    const currentValidRows = await this.setupRepo.find({
      where: { hotel_id: targetHotelId, setup_status: 1 }
    });

    // Trigger real-time static data push to Google ARI
    if (currentValidRows.length > 0) {
      // Safely resolve the real hotel code directly from the active database row
      const actualDbHotelCode = currentValidRows[0].hotel_code;

      if (!actualDbHotelCode) {
        this.logger.error(`Aborting static push for Hotel ID ${targetHotelId}. Active rows lack a valid hotel_code.`);
        return;
      }

      const hotelListXml = GoogleStaticFeedBuilder.buildHotelListFeed(currentValidRows);
      const transactionXml = GoogleStaticFeedBuilder.buildTransactionMetadata(actualDbHotelCode, currentValidRows);

      this.logger.log(`Executing static push for Hotel ID: ${targetHotelId} with ${currentValidRows.length} active rows`);
      await this.googleApiConnector.pushPayload(actualDbHotelCode, hotelListXml, 'HotelListFeed');
      await this.googleApiConnector.pushPayload(actualDbHotelCode, transactionXml, 'TransactionMetadata');
    } else {
      this.logger.warn(`Static push aborted for Hotel ID ${targetHotelId}. No valid live rows available.`);
    }
  }
}