import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { Hotel } from '../../common/entities/hotel.entity';
import { HotelRoomType } from '../../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../../common/entities/hotel-rate-plan.entity';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';
import { GoogleSyncService } from './google-sync.service';
import { GoogleApiService } from './google-api.service';
import { GoogleStaticFeedBuilder } from '../builders/google-static-feed.builder';

@Injectable()
export class PropertyMaterializerService {
  private readonly logger = new Logger(PropertyMaterializerService.name);

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepo: Repository<Hotel>,
    @Inject(forwardRef(() => GoogleSyncService))
    private readonly googleSyncService: GoogleSyncService,
    private readonly googleApiService: GoogleApiService,
  ) {}

  /**
   * Database transaction processing for property updates / extranet delta updates.
   * The entire database workflow is executed within a transaction (QueryRunner) to ensure consistency and atomicity.
   * External API calls are intentionally separated outside the transaction to avoid holding database locks.
   */
  async handleExtranetDeltaUpdate(
    entityReference: any,
    updateType: string,
    queryRunner: QueryRunner
  ): Promise<{ shouldPush: boolean; hotelCode: string; flatData: any[]; roomTypeId?: number; ratePlanId?: number }> {
    // -------------------------------------------------------------------------
    // STAGE 1: Input Parameter Validation
    // -------------------------------------------------------------------------
    const hotelId = entityReference?.hotelId;
    if (!hotelId) {
      throw new Error('hotelId is mandatory');
    }

    if (updateType === 'ROOM_UPDATE' && !entityReference.roomId) {
      throw new Error('ROOM_UPDATE requires roomId');
    }

    if (updateType === 'RATE_PLAN_UPDATE') {
      if (!entityReference.roomId || !entityReference.rateId) {
        throw new Error('RATE_PLAN_UPDATE requires both roomId and rateId');
      }
    }

    this.logger.log(`[PROPERTY DELTA] Processing DB transaction for ${updateType} (Hotel ID/Code: ${hotelId})`);

    const manager = queryRunner.manager;

    // -------------------------------------------------------------------------
    // STAGE 2: Master Entity Verification & Locking (Hotel, Room Type, Rate Plan)
    // -------------------------------------------------------------------------
    let hotel: Hotel | null;
    if (typeof hotelId === 'number') {
      hotel = await manager.findOne(Hotel, { where: { id: hotelId } });
    } else {
      hotel = await manager.findOne(Hotel, { where: { code: hotelId } });
    }

    if (!hotel) {
      throw new Error(`Hotel not found for ID/Code: ${hotelId}`);
    }

    // Auto-Bootstrap: Ensure connectivity setup record exists if not already present
    await this.ensureSetupExists(hotel.id, queryRunner);

    // Verify room and rate entities existence if provided
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

    // -------------------------------------------------------------------------
    // STAGE 3: Precise DB Delta Update Execution (Raw SQL JOIN)
    // Executed specifically based on updateType before Gatekeeper reads the snapshot
    // -------------------------------------------------------------------------
    if (updateType === 'HOTEL_UPDATE') {
      this.logger.log(`[PROPERTY DB UPDATE] Aligning master hotel profile for: ${hotel.code}`);
      await manager.query(
        `
        UPDATE tb_hotel_connectivity_setup s
        JOIN tb_hotel h ON s.hotel_id = h.id
        LEFT JOIN ms_property_category cat ON h.property_category = cat.id
        LEFT JOIN ms_brand br ON h.property_brand = br.id
        SET 
          s.hotel_name = h.name,
          s.property_category = cat.category_name,
          s.hotel_brand = br.brand_name,
          s.street_address = h.street_address,
          s.city = h.area,
          s.province = h.region,
          s.latitude = h.latitude,
          s.longitude = h.longitude,
          s.phone = h.phone
        WHERE s.hotel_id = ?
      `,
        [hotel.id]
      );
    } else if (updateType === 'ROOM_UPDATE') {
      this.logger.log(`[PROPERTY DB UPDATE] Aligning room data ID ${entityReference.roomId} for: ${hotel.code}`);
      await manager.query(
        `
        UPDATE tb_hotel_connectivity_setup s
        JOIN tb_hotel_room_type rt ON s.room_type_id = rt.id
        SET 
          s.room_type_name = rt.name,
          s.room_capacity = rt.guest,
          s.room_smoking = rt.smoking,
          s.room_view = rt.view
        WHERE s.hotel_id = ? AND s.room_type_id = ?
      `,
        [hotel.id, entityReference.roomId]
      );
    } else if (updateType === 'RATE_PLAN_UPDATE') {
      this.logger.log(`[PROPERTY DB UPDATE] Aligning rate plan ID ${entityReference.rateId} for: ${hotel.code}`);
      await manager.query(
        `
        UPDATE tb_hotel_connectivity_setup s
        JOIN tb_hotel_rate_plan rp ON s.rate_plan_id = rp.id
        SET 
          s.rate_plan_name = rp.name,
          s.breakfast_included = rp.food,
          s.pay_at_hotel = rp.pay_at_hotel
        WHERE s.hotel_id = ? AND s.rate_plan_id = ?
      `,
        [hotel.id, entityReference.rateId]
      );
    }

    // -------------------------------------------------------------------------
    // STAGE 4: Latest Snapshot Retrieval & Strict Gatekeeper Validation
    // Utilizing TypeORM Entity (HotelConnectivitySetup) for type-safety
    // -------------------------------------------------------------------------
    const flatData = await manager.find(HotelConnectivitySetup, {
      where: { hotel_code: hotel.code },
    });

    // Validate eligibility of all hotel setup rows
    const isAllValid = flatData.length > 0 && flatData.every((row: HotelConnectivitySetup) => this.validateGatekeeper(row) === 1);

    if (!isAllValid) {
      this.logger.warn(`[GATEKEEPER UNQUALIFIED] Hotel ${hotel.code} failed Gatekeeper validation: Profile/room/rate data is incomplete.`);

      await manager.update(HotelConnectivitySetup, { hotel_code: hotel.code }, { setup_status: 0 });

      return { shouldPush: false, hotelCode: hotel.code, flatData: [] };
    }

    // Mark setup status as active (setup_status = 1) if validation passes
    await manager.update(HotelConnectivitySetup, { hotel_code: hotel.code }, { setup_status: 1 });

    this.logger.log(`[GATEKEEPER PASSED] Hotel ${hotel.code} marked as valid & active. Preparing external API trigger.`);

    // Build active snapshot array to be passed to static feed XML builder
    const activeFlatData = flatData.map((row) => ({ ...row, setup_status: 1, setupStatus: 1 }));

    return {
      shouldPush: true,
      hotelCode: hotel.code,
      flatData: activeFlatData,
      roomTypeId: entityReference.roomId,
      ratePlanId: entityReference.rateId,
    };
  }

  /**
   * External API Trigger Execution (Static Push & Domino ARI Sync).
   * Executed AFTER the database transaction is successfully committed to prevent holding DB locks due to network latency.
   */
  async executeExternalPush(
    hotelCode: string,
    flatData: any[],
    updateType: string,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<void> {
    // 1. Dispatch Static Profile Feeds (ListFeed & Transaction Metadata) to Google
    if (flatData && flatData.length > 0) {
      this.logger.log(`[STATIC PUSH] Generating & sending static profile XML feeds for hotel: ${hotelCode}`);
      const hotelListFeedXml = GoogleStaticFeedBuilder.buildHotelListFeed(flatData);
      const transactionMetadataXml = GoogleStaticFeedBuilder.buildTransactionMetadata(hotelCode, flatData);

      await this.googleApiService.pushPayload(hotelCode, hotelListFeedXml, 'ListFeed');
      await this.googleApiService.pushPayload(hotelCode, transactionMetadataXml, 'Transaction');
    } else {
      this.logger.warn(`[STATIC PUSH SKIPPED] Connectivity setup data is empty for hotel ${hotelCode}. Skipping static push.`);
    }

    // 2. Domino Effect: If Room or Rate Plan updates occur, trigger 365-day ARI synchronization
    if (updateType !== 'HOTEL_UPDATE') {
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      this.logger.log(`[DOMINO EFFECT] Triggering 365-day ARI synchronization for hotel: ${hotelCode} (${startDate} to ${endDate})`);
      await this.googleSyncService.syncDateRange(hotelCode, startDate, endDate, roomTypeId, ratePlanId, updateType);
    }
  }

  /**
   * Strict Gatekeeper Validation Evaluation (4 Layer Verification):
   * 1. Hotel Profile (Code, Name, Address, City, Province, Phone must be provided)
   * 2. Geo-Coordinates (Latitude & Longitude valid and non-zero)
   * 3. Room Details (ID, Room Name required, Capacity > 0)
   * 4. Rate Details (ID, Rate Plan Name required)
   *
   * Return: 1 (Valid/Passed) | 0 (Incomplete/Locked)
   */
  private validateGatekeeper(row: any): number {
    if (!row) return 0;

    // 1. Validate Hotel Profile & Address
    const hotelCode = row.hotel_code;
    const hotelName = row.hotel_name;
    const streetAddress = row.street_address;
    const city = row.city;
    const province = row.province;
    const phone = row.phone;
    const isHotelValid = [hotelCode, hotelName, streetAddress, city, province, phone]
      .every(field => field && field.toString().trim() !== '');
    
    // 2. Validate Geo-Coordinates
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    const isGeoValid = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

    // 3. Validate Room Type
    const roomTypeId = row.room_type_id;
    const roomTypeName = row.room_type_name;
    const roomCapacity = row.room_capacity;

    const isRoomValid = roomTypeId && 
                        roomTypeName && 
                        roomTypeName.toString().trim() !== '' && 
                        Number(roomCapacity) > 0;

    // 4. Validate Rate Plan
    const ratePlanId = row.rate_plan_id;
    const ratePlanName = row.rate_plan_name;

    const isRateValid = ratePlanId && 
                        ratePlanName && 
                        ratePlanName.toString().trim() !== '';

    // Returns 1 only if ALL 4 layers are valid
    return (isHotelValid && isGeoValid && isRoomValid && isRateValid) ? 1 : 0;
  }

  /**
   * Auto-Bootstrap Feature:
   * Checks whether the connectivity setup table already contains snapshot rows for the given hotel.
   * If missing, it automatically extracts data from the Master Relational DB (tb_hotel, tb_hotel_room_type, tb_hotel_rate_plan)
   * and inserts them into tb_hotel_connectivity_setup.
   */
  private async ensureSetupExists(hotelId: number, queryRunner: QueryRunner): Promise<void> {
    const manager = queryRunner.manager;
    const existing = await manager.query(
      `SELECT hotel_code FROM tb_hotel_connectivity_setup WHERE hotel_id = ? LIMIT 1`,
      [hotelId]
    );

    if (existing.length === 0) {
      this.logger.log(`[AUTO-BOOTSTRAP] Setup data does not exist for hotel ID ${hotelId}. Extracting from Master DB...`);
      const masterData = await manager.query(
        `
        SELECT 
          h.id, h.code, h.name, cat.category_name, br.brand_name,
          h.street_address, h.area as city, h.region as province, h.zip_code, 'ID' as country,
          h.latitude, h.longitude, h.phone,
          rt.id as room_id, rt.name as room_name, rt.guest as capacity, rt.smoking, rt.view,
          (SELECT filename FROM tb_hotel_image img WHERE img.room_type_id = rt.id AND img.type = 1 LIMIT 1) as room_image,
          rp.id as rate_id, rp.name as rate_name, rp.food, rp.pay_at_hotel
        FROM tb_hotel h
        LEFT JOIN ms_property_category cat ON h.property_category = cat.id
        LEFT JOIN ms_brand br ON h.property_brand = br.id
        JOIN tb_hotel_room_type rt ON rt.hotel_id = h.id
        JOIN tb_hotel_rate_plan rp ON rp.room_type_id = rt.id
        WHERE h.id = ?
      `,
        [hotelId]
      );

      for (const row of masterData) {
        await manager.query(
          `
          INSERT INTO tb_hotel_connectivity_setup 
          (hotel_id, hotel_code, hotel_name, property_category, hotel_brand, street_address, city, province, zip_code, country, latitude, longitude, phone,
           room_type_id, room_type_name, room_capacity, room_smoking, room_view, room_image_url,
           rate_plan_id, rate_plan_name, breakfast_included, pay_at_hotel, setup_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `,
          [
            row.id,
            row.code,
            row.name,
            row.category_name || 'N/A',
            row.brand_name || 'N/A',
            row.street_address,
            row.city,
            row.province,
            row.zip_code,
            row.country,
            row.latitude,
            row.longitude,
            row.phone,
            row.room_id,
            row.room_name,
            row.capacity,
            row.smoking,
            row.view,
            row.room_image,
            row.rate_id,
            row.rate_name,
            row.food,
            row.pay_at_hotel,
          ]
        );
      }
      this.logger.log(`[AUTO-BOOTSTRAP SUCCESS] Connectivity setup data successfully created for hotel ID ${hotelId}`);
    }
  }
}