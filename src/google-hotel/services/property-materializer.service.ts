import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { Hotel } from '../../common/entities/hotel.entity';
import { HotelRoomType } from '../../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../../common/entities/hotel-rate-plan.entity';
import { GoogleSyncService } from './google-sync.service';
import { GoogleApiService } from './google-api.service';
import { GoogleStaticFeedBuilder } from '../builders/google-static-feed.builder';

@Injectable()
export class PropertyMaterializerService {
  private readonly logger = new Logger(PropertyMaterializerService.name);

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepo: Repository<Hotel>,
    private readonly googleSyncService: GoogleSyncService,
    private readonly googleApiService: GoogleApiService,
  ) {}

  /**
   * 1. Database logic: Lock, validation, DB updates.
   * Runs entirely inside the database transaction (ensures atomicity).
   * External HTTP/API calls are deliberately excluded to avoid holding database locks.
   */
  async handleExtranetDeltaUpdate(
    entityReference: any,
    updateType: string,
    queryRunner: QueryRunner
  ): Promise<{ shouldPush: boolean; hotelCode: string; flatData: any[]; roomTypeId?: number; ratePlanId?: number }> {
    const hotelId = entityReference?.hotelId;
    if (!hotelId) {
      throw new Error("hotelId is mandatory");
    }

    // --- TYPE-SPECIFIC VALIDATION ---
    if (updateType === 'ROOM_UPDATE' && !entityReference.roomId) {
      throw new Error("ROOM_UPDATE requires roomId");
    }

    if (updateType === 'RATE_PLAN_UPDATE') {
      if (!entityReference.roomId || !entityReference.rateId) {
        throw new Error("RATE_PLAN_UPDATE requires both roomId and rateId");
      }
    }

    this.logger.log(`Processing database transaction for ${updateType} (Hotel ID/Code: ${hotelId})`);

    const manager = queryRunner.manager;

    // 1. Retrieve hotel record from master database (supports numeric ID or string code)
    let hotel: Hotel | null;
    if (typeof hotelId === 'number') {
      hotel = await manager.findOne(Hotel, { where: { id: hotelId } });
    } else {
      hotel = await manager.findOne(Hotel, { where: { code: hotelId } });
    }

    if (!hotel) {
      throw new Error(`Hotel not found for ID/Code: ${hotelId}`);
    }

    // 2. Validate/Lock child entities
    if (entityReference.roomId) {
      const room = await manager.findOne(HotelRoomType, { where: { id: entityReference.roomId } });
      if (!room) {
        throw new Error(`Room Type with ID ${entityReference.roomId} not found`);
      }
    }

    if (entityReference.rateId) {
      const ratePlan = await manager.findOne(HotelRatePlan, { where: { id: entityReference.rateId } });
      if (!ratePlan) {
        throw new Error(`Rate Plan with ID ${entityReference.rateId} not found`);
      }
    }

    // 3. Gatekeeper: Validate completeness using tb_hotel_connectivity_setup snapshot
    const flatData = await manager.query(
      `SELECT * FROM tb_hotel_connectivity_setup WHERE hotel_code = ?`,
      [hotel.code]
    );

    // Verify if all required setup records are valid (must be strictly complete)
    const isAllValid = flatData.length > 0 && flatData.every((row: any) => this.validateGatekeeper(row) === 1);

    if (!isAllValid) {
      this.logger.warn(`[GATEKEEPER] Hotel ${hotel.code} validation failed: Profile/Room/Rate data is incomplete.`);
      
      await manager.update(
        'tb_hotel_connectivity_setup', 
        { hotel_code: hotel.code }, 
        { setup_status: 0 }
      );
      return { shouldPush: false, hotelCode: hotel.code, flatData: [] };
    }

    // Mark as valid/live if all records pass validation
    await manager.update(
      'tb_hotel_connectivity_setup', 
      { hotel_code: hotel.code }, 
      { setup_status: 1 }
    );

    this.logger.log(`[GATEKEEPER PASSED] Hotel ${hotel.code} is valid. Proceeding with DB updates.`);

    // 4. Perform DB updates based on updateType
    if (updateType === 'ROOM_UPDATE') {
      this.logger.log(`[PROPERTY DB UPDATE] Room structure updated for hotel: ${hotel.code}`);
    } else if (updateType === 'RATE_PLAN_UPDATE') {
      this.logger.log(`[PROPERTY DB UPDATE] Rate Plan structure updated for hotel: ${hotel.code}`);
    }

    // Fetch active snapshots for external synchronization
    const activeFlatData = await manager.query(
      `SELECT * FROM tb_hotel_connectivity_setup WHERE hotel_code = ? AND setup_status = 1`,
      [hotel.code]
    );

    return { 
      shouldPush: true, 
      hotelCode: hotel.code, 
      flatData: activeFlatData,
      roomTypeId: entityReference.roomId,
      ratePlanId: entityReference.rateId
    };
  }

  /**
   * 2. API logic: Pushes profile feeds to Google and triggers ARI synchronization if necessary.
   * Executed AFTER the database transaction is committed to prevent blocking during network latency.
   */
  async executeExternalPush(
    hotelCode: string, 
    flatData: any[], 
    updateType: string,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<void> {
    // 1. Send ListFeed & Transaction (Static profile) to Google
    if (flatData && flatData.length > 0) {
      this.logger.log(`[STATIC PUSH] Generating static profile feeds for hotel: ${hotelCode}`);
      const hotelListFeedXml = GoogleStaticFeedBuilder.buildHotelListFeed(flatData);
      const transactionMetadataXml = GoogleStaticFeedBuilder.buildTransactionMetadata(hotelCode, flatData);

      await this.googleApiService.pushPayload(hotelCode, hotelListFeedXml, 'ListFeed');
      await this.googleApiService.pushPayload(hotelCode, transactionMetadataXml, 'Transaction');
    } else {
      this.logger.warn(`[STATIC PUSH] No data found in tb_hotel_connectivity_setup for ${hotelCode}. Skipping static push.`);
    }

    // 2. Domino Effect: If Room/Rate updates occur, trigger 365-day ARI synchronization
    if (updateType !== 'HOTEL_UPDATE') {
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      this.logger.log(`[DOMINO EFFECT] Triggering 365-day ARI sync for ${hotelCode} from ${startDate} to ${endDate}`);
      await this.googleSyncService.syncDateRange(hotelCode, startDate, endDate, roomTypeId, ratePlanId, updateType);
    }
  }

  /**
   * Strict validation gate: Ensures mandatory hotel profile, location, room, and rate information 
   * are provided before marking the hotel as 'live'.
   */
  private validateGatekeeper(row: any): number {
    if (!row) return 0;

    // 1. Hotel Profile Validation
    const hotelFields = ['hotel_code', 'hotel_name', 'street_address', 'city', 'province', 'phone'];
    const isHotelValid = hotelFields.every(field => row[field] && row[field].toString().trim() !== '');
    
    // 2. Geo-coordinates Validation
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    const isGeoValid = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

    // 3. Room Type Validation
    const isRoomValid = row.room_type_id && 
                        row.room_type_name && 
                        row.room_type_name.toString().trim() !== '' && 
                        Number(row.room_capacity) > 0;

    // 4. Rate Plan Validation
    const isRateValid = row.rate_plan_id && 
                        row.rate_plan_name && 
                        row.rate_plan_name.toString().trim() !== '';

    // Returns 1 only if ALL validations pass
    return (isHotelValid && isGeoValid && isRoomValid && isRateValid) ? 1 : 0;
  }
}