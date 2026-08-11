import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Hotel } from '../../common/entities/hotel.entity';
import { HotelRoomType } from '../../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../../common/entities/hotel-rate-plan.entity';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';
import { GoogleSyncService } from './google-sync.service';
import { GoogleApiService } from './google-api.service';
import { GoogleStaticFeedBuilder } from '../builders/google-static-feed.builder';
import { AvailabilityBuilder } from '../builders/availability.builder';

@Injectable()
export class PropertyMaterializerService {
  private readonly logger = new Logger(PropertyMaterializerService.name);

  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepo: Repository<Hotel>,
    @Inject(forwardRef(() => GoogleSyncService))
    private readonly googleSyncService: GoogleSyncService,
    private readonly googleApiService: GoogleApiService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Processes database transactions for property updates and extranet delta syncs.
   * The entire database operations are executed within a QueryRunner transaction to ensure data consistency and atomicity.
   * External API calls are deliberately isolated outside the transaction to prevent holding DB locks during network calls.
   */
  async handleExtranetDeltaUpdate(
    entityReference: any,
    updateType: string,
    queryRunner: QueryRunner
  ): Promise<{ shouldPush: boolean; hotelCode: string; flatData: any[]; roomTypeId?: number; ratePlanId?: number; deletedSetups?: any[]; shouldTeardown?: boolean } | null> {
    // -------------------------------------------------------------------------
    // STAGE 1: Input Parameter Validation
    // -------------------------------------------------------------------------
    const hotelId = entityReference?.hotelId;
    if (!hotelId) {
      this.logger.warn(`[PROPERTY SYNC SKIPPED] Missing mandatory hotelId in payload. Skipping SQS event safely.`);
      return null;
    }

    // Validate supported updateTypes to prevent errors from malformed or unknown payloads
    const supportedUpdateTypes = ['HOTEL_UPDATE', 'ROOM_UPDATE', 'RATE_PLAN_UPDATE', 'HOTEL_DELETE', 'ROOM_DELETE', 'RATE_PLAN_DELETE'];
    if (!updateType || !supportedUpdateTypes.includes(updateType)) {
      this.logger.warn(`[PROPERTY SYNC SKIPPED] Unrecognized or invalid updateType: '${updateType}' for hotel ID/Code: ${hotelId}. Skipping SQS event safely.`);
      return null;
    }

    // Validate specific parameters based on updateType
    if (updateType === 'ROOM_UPDATE' && !entityReference.roomId) {
      this.logger.warn(`[PROPERTY SYNC SKIPPED] ROOM_UPDATE missing mandatory roomId for hotel ID/Code: ${hotelId}. Skipping safely.`);
      return null;
    }
    if (updateType === 'RATE_PLAN_UPDATE' && (!entityReference.roomId || !entityReference.rateId)) {
      this.logger.warn(`[PROPERTY SYNC SKIPPED] RATE_PLAN_UPDATE missing roomId or rateId for hotel ID/Code: ${hotelId}. Skipping safely.`);
      return null;
    }
    
    if (!hotelId) throw new Error('hotelId is mandatory');
    if (updateType === 'ROOM_UPDATE' && !entityReference.roomId) throw new Error('ROOM_UPDATE requires roomId');
    if (updateType === 'RATE_PLAN_UPDATE' && (!entityReference.roomId || !entityReference.rateId)) throw new Error('RATE_PLAN_UPDATE requires both roomId and rateId');

    this.logger.log(`[PROPERTY DELTA] Processing DB transaction for ${updateType} (Hotel ID/Code: ${hotelId})`);
    const manager = queryRunner.manager;

    // -------------------------------------------------------------------------
    // STAGE 2: HANDLE HOTEL_DELETE FIRST (Before querying master tb_hotel)
    // If the hotel has already been purged from master DB, the findOne lookup will fail.
    // -------------------------------------------------------------------------
    if (updateType === 'HOTEL_DELETE') {
      this.logger.log(`[PROPERTY DB UPDATE] Deleting / Teardown entire hotel ID/Code: ${hotelId}`);
      
      // Retrieve the latest setup snapshot for Google Teardown processing
      let deletedSetups = [];
      const numericHotelId = Number(hotelId);
      if (!isNaN(numericHotelId)) {
        deletedSetups = await manager.find(HotelConnectivitySetup, { where: { hotel_id: numericHotelId } });
      } else {
        const hIdStr = String(hotelId);
        deletedSetups = await manager.find(HotelConnectivitySetup, { where: { hotel_code: hIdStr } });
      }

      if (deletedSetups.length > 0) {
        const hCode = deletedSetups[0].hotel_code;
        
        // Update status to 0 (inactive/deactivated) to signal deactivation to the gatekeeper
        if (!isNaN(numericHotelId)) {
          await manager.update(HotelConnectivitySetup, { hotel_id: numericHotelId }, { setup_status: 0 });
        } else {
          await manager.update(HotelConnectivitySetup, { hotel_code: String(hotelId) }, { setup_status: 0 });
        }

        return { 
          shouldPush: false, 
          shouldTeardown: true, // Triggers executeTeardown() in the consumer
          hotelCode: hCode, 
          flatData: deletedSetups, // Contains last known room/rate configurations for closeout
          deletedSetups: deletedSetups 
        };
      } else {
         this.logger.warn(`Hotel ID ${hotelId} is already deleted or has no setup record. Skipping SQS event.`);
         return null; // Skip execution if no active setup data exists to teardown
      }
    }

    // -------------------------------------------------------------------------
    // STAGE 3: Master Entity Verification & Locking (For Update / Create / Partial Delete)
    // -------------------------------------------------------------------------
    let hotel: Hotel | null;
    const numericHotelId = Number(hotelId);
    if (!isNaN(numericHotelId)) {
      hotel = await manager.findOne(Hotel, { where: { id: numericHotelId } });
    } else {
      hotel = await manager.findOne(Hotel, { where: { code: String(hotelId) } });
    }

    if (!hotel) {
      this.logger.warn(`[PROPERTY SYNC SKIPPED] Hotel not found for ID/Code: ${hotelId}. Skipping SQS event safely.`);
      return null;
    }

    // Jika hotel dinonaktifkan di master (status = 0), paksa setup_status jadi 0 dan teardown
    if (hotel.status !== 1) {
      this.logger.log(`[HOTEL INACTIVE] Hotel ${hotel.code} is inactive (status = 0). Deactivating setup & tearing down.`);
      
      const existingSetups = await manager.find(HotelConnectivitySetup, { where: { hotel_id: hotel.id } });
      if (existingSetups.length > 0) {
        await manager.update(HotelConnectivitySetup, { hotel_id: hotel.id }, { setup_status: 0 });
      }

      return {
        shouldPush: false,
        shouldTeardown: true,
        hotelCode: hotel.code,
        flatData: existingSetups,
        deletedSetups: existingSetups,
      };
    }

    // Auto-Bootstrap: Ensure connectivity setup record exists
    await this.ensureSetupExists(hotel.id, queryRunner);

    // Verify room and rate entities (Excluding delete operations)
    if (updateType !== 'ROOM_DELETE' && updateType !== 'RATE_PLAN_DELETE') {
      if (entityReference.roomId) {
        const room = await manager.findOne(HotelRoomType, { where: { id: entityReference.roomId } });
        if (!room) throw new Error(`Room Type with ID ${entityReference.roomId} not found`);
      }
      if (entityReference.rateId) {
        const ratePlan = await manager.findOne(HotelRatePlan, { where: { id: entityReference.rateId } });
        if (!ratePlan) throw new Error(`Rate Plan with ID ${entityReference.rateId} not found`);
      }
    }

    // -------------------------------------------------------------------------
    // STAGE 4: Precise DB Delta Update Execution (Raw SQL JOIN or DELETE)
    // Executed specifically based on updateType before Gatekeeper reads the snapshot
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // STAGE 4: Precise DB Delta Update Execution (UPSERT Logic)
    // -------------------------------------------------------------------------
    if (updateType === 'ROOM_DELETE') {
      this.logger.log(`[PROPERTY DB UPDATE] Deleting room ID ${entityReference.roomId} for hotel: ${hotel.code}`);
      const deletedSetups = await manager.find(HotelConnectivitySetup, { where: { hotel_id: hotel.id, room_type_id: entityReference.roomId } });
      await manager.delete(HotelConnectivitySetup, { hotel_id: hotel.id, room_type_id: entityReference.roomId });
      (queryRunner as any).deletedSetups = deletedSetups; 
    } 
    else if (updateType === 'RATE_PLAN_DELETE') {
      this.logger.log(`[PROPERTY DB UPDATE] Deleting rate plan ID ${entityReference.rateId} for hotel: ${hotel.code}`);
      const deletedSetups = await manager.find(HotelConnectivitySetup, { where: { hotel_id: hotel.id, rate_plan_id: entityReference.rateId } });
      await manager.delete(HotelConnectivitySetup, { hotel_id: hotel.id, rate_plan_id: entityReference.rateId });
      (queryRunner as any).deletedSetups = deletedSetups;
    }
    else if (['HOTEL_UPDATE', 'ROOM_UPDATE', 'RATE_PLAN_UPDATE'].includes(updateType)) {
      this.logger.log(`[PROPERTY DB UPDATE] Executing UPSERT for ${updateType} on hotel: ${hotel.code}`);
      
      let filterSql = '';
      const params: any[] = [hotel.id];

      if (updateType === 'ROOM_UPDATE') {
        filterSql = 'AND rt.id = ?';
        params.push(entityReference.roomId);
      } else if (updateType === 'RATE_PLAN_UPDATE') {
        filterSql = 'AND rp.id = ?';
        params.push(entityReference.rateId);
      }

      await manager.query(
        `
        INSERT INTO tb_hotel_connectivity_setup (
          hotel_id, hotel_code, hotel_name, property_category, hotel_brand,
          street_address, city, province, zip_code, country, latitude, longitude, phone,
          room_type_id, room_type_name, room_capacity, room_smoking, room_view, room_image_url,
          rate_plan_id, rate_plan_name, breakfast_included, pay_at_hotel, setup_status,
          created_at, updated_at
        )
        SELECT 
          h.id, h.code, h.name, COALESCE(cat.category_name, 'N/A'), COALESCE(br.brand_name, 'N/A'),
          h.street_address, h.area, h.region, h.zip_code, 'ID', h.latitude, h.longitude, h.phone,
          rt.id, rt.name, rt.guest, rt.smoking, rt.view,
          (SELECT filename FROM tb_hotel_image img WHERE img.hotel_id = h.id AND img.room_type_id = rt.id AND img.type = 1 LIMIT 1),
          rp.id, rp.name, rp.food, rp.pay_at_hotel, 
          0 as setup_status, 
          NOW(), NOW()
        FROM tb_hotel h
        LEFT JOIN ms_property_category cat ON h.property_category = cat.id
        LEFT JOIN ms_brand br ON h.property_brand = br.id
        JOIN tb_hotel_room_type rt ON rt.hotel_id = h.id
        JOIN tb_hotel_rate_plan rp ON rp.room_type_id = rt.id
        WHERE h.id = ? AND h.status = 1 ${filterSql}
        ON DUPLICATE KEY UPDATE
          hotel_name = VALUES(hotel_name),
          property_category = VALUES(property_category),
          hotel_brand = VALUES(hotel_brand),
          street_address = VALUES(street_address),
          city = VALUES(city),
          province = VALUES(province),
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          phone = VALUES(phone),
          room_type_name = VALUES(room_type_name),
          room_capacity = VALUES(room_capacity),
          room_smoking = VALUES(room_smoking),
          room_view = VALUES(room_view),
          room_image_url = VALUES(room_image_url),
          rate_plan_name = VALUES(rate_plan_name),
          breakfast_included = VALUES(breakfast_included),
          pay_at_hotel = VALUES(pay_at_hotel),
          updated_at = NOW();
        `,
        params
      );
    }

    // -------------------------------------------------------------------------
    // STAGE 5: Gatekeeper Validation & Activation Logic
    // -------------------------------------------------------------------------
    const flatData = await manager.find(HotelConnectivitySetup, {
      where: { hotel_code: hotel.code },
    });

    // Check if this hotel was PREVIOUSLY active (contains setup_status = 1)
    const wasActive = flatData.some(row => row.setup_status === 1);
    const isAllValid = flatData.length > 0 && flatData.every((row: HotelConnectivitySetup) => this.validateGatekeeper(row) === 1);

    if (!isAllValid) {
      this.logger.warn(`[GATEKEEPER UNQUALIFIED] Hotel ${hotel.code} failed Gatekeeper validation: Profile/room/rate data is incomplete.`);

      await manager.update(HotelConnectivitySetup, { hotel_code: hotel.code }, { setup_status: 0 });

      return { 
        shouldPush: false, 
        shouldTeardown: wasActive,
        hotelCode: hotel.code, 
        flatData: flatData, 
        deletedSetups: (queryRunner as any).deletedSetups || [],
        roomTypeId: entityReference.roomId,
        ratePlanId: entityReference.rateId
      };
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
      deletedSetups: (queryRunner as any).deletedSetups || [],
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
    // // 1. Dispatch Static Profile Feeds (ListFeed & Transaction Metadata) to Google
    // if (flatData && flatData.length > 0) {
    //   this.logger.log(`[STATIC PUSH] Generating & sending static profile XML feeds for hotel: ${hotelCode}`);
    //   const hotelListFeedXml = GoogleStaticFeedBuilder.buildHotelListFeed(flatData);
    //   const transactionMetadataXml = GoogleStaticFeedBuilder.buildTransactionMetadata(hotelCode, flatData);

    //   await this.googleApiService.pushPayload(hotelCode, hotelListFeedXml, 'ListFeed');
    //   await this.googleApiService.pushPayload(hotelCode, transactionMetadataXml, 'Transaction');
    // } else {
    //   this.logger.warn(`[STATIC PUSH SKIPPED] Connectivity setup data is empty for hotel ${hotelCode}. Skipping static push.`);
    // }

    // // 2. Domino Effect: If Room or Rate Plan updates occur, trigger 365-day ARI synchronization
    // if (updateType !== 'HOTEL_UPDATE' && updateType !== 'ROOM_DELETE' && updateType !== 'RATE_PLAN_DELETE' && updateType !== 'HOTEL_DELETE') {
    //   const startDate = new Date().toISOString().split('T')[0];
    //   const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    //   this.logger.log(`[DOMINO EFFECT] Triggering 365-day ARI synchronization for hotel: ${hotelCode} (${startDate} to ${endDate})`);
    //   await this.googleSyncService.syncDateRange(hotelCode, startDate, endDate, roomTypeId, ratePlanId, updateType);
    // }
    this.logger.log(`[EXTERNAL PUSH DISABLED] Skipping static profile feeds and domino ARI sync for hotel: ${hotelCode} (${updateType}). Managed strictly via Delta/Manual Sync.`);
    return;
  }

  /**
   * Executes Master Close (Teardown) for deactivated or removed property records.
   */
  async executeTeardown(hotelCode: string, flatData: any[]): Promise<void> {
    this.logger.log(`[TEARDOWN] Executing Master Close for hotel ${hotelCode}.`);

    // Use the same ROLLING_HORIZON_MONTHS configuration as the Cron service
    const horizonMonths = parseInt(this.configService.get('ROLLING_HORIZON_MONTHS', '3'), 10);
    const today = new Date();
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + horizonMonths); // Set target end date according to horizon settings

    const combinations = flatData.map(row => ({
      date: today,
      endDate: endDate,
      room_type_id: row.room_type_id,
      rate_plan_id: row.rate_plan_id,
      restriction_master: 1, // 1 = Close (Stop Sell)
      set_min_los: 1 
    }));

    if (combinations.length > 0) {
      const availXml = AvailabilityBuilder.buildAvailNotifRQ(hotelCode, combinations);
      await this.googleApiService.pushPayload(hotelCode, availXml, 'Avail (Teardown)');
      this.logger.log(`[TEARDOWN] Pushed Stop Sell until ${endDate.toISOString().split('T')[0]}`);
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