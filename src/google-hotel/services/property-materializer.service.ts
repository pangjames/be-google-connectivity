import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Hotel } from '../../common/entities/hotel.entity';
import { HotelRoomType } from '../../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../../common/entities/hotel-rate-plan.entity';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';
import { GoogleSyncService } from './google-sync.service';
import { GoogleApiService } from './google-api.service';
import { AvailabilityBuilder } from '../builders/availability.builder';

@Injectable()
export class PropertyMaterializerService {
  private readonly logger = new Logger(PropertyMaterializerService.name);

  constructor(
    @InjectRepository(Hotel) // DB Core
    private readonly hotelRepo: Repository<Hotel>,
    @InjectRepository(HotelConnectivitySetup, 'googleConnection') // DB Google
    private readonly setupRepo: Repository<HotelConnectivitySetup>,
    @InjectDataSource() private readonly coreDataSource: DataSource,
    @InjectDataSource('googleConnection') private readonly googleDataSource: DataSource,
    @Inject(forwardRef(() => GoogleSyncService))
    private readonly googleSyncService: GoogleSyncService,
    private readonly googleApiService: GoogleApiService,
    private readonly configService: ConfigService,
  ) {}

  async handleExtranetDeltaUpdate(
    entityReference: any,
    updateType: string,
    queryRunner: QueryRunner
  ): Promise<{ shouldPush: boolean; hotelCode: string; flatData: any[]; roomTypeId?: number; ratePlanId?: number; deletedSetups?: any[]; shouldTeardown?: boolean } | null> {
    const hotelId = entityReference?.hotelId;
    if (!hotelId) {
      this.logger.warn(`[PROPERTY SYNC SKIPPED] Missing mandatory hotelId in payload.`);
      return null;
    }

    const supportedUpdateTypes = ['HOTEL_UPDATE', 'ROOM_UPDATE', 'RATE_PLAN_UPDATE', 'HOTEL_DELETE', 'ROOM_DELETE', 'RATE_PLAN_DELETE'];
    if (!updateType || !supportedUpdateTypes.includes(updateType)) {
      this.logger.warn(`[PROPERTY SYNC SKIPPED] Unrecognized updateType: '${updateType}'`);
      return null;
    }

    this.logger.log(`[PROPERTY DELTA] Processing DB transaction for ${updateType} (Hotel ID/Code: ${hotelId})`);
    const manager = queryRunner.manager;
    const googleManager = this.googleDataSource.manager;

    if (updateType === 'HOTEL_DELETE') {
      let deletedSetups = [];
      const numericHotelId = Number(hotelId);
      if (!isNaN(numericHotelId)) {
        deletedSetups = await googleManager.find(HotelConnectivitySetup, { where: { hotel_id: numericHotelId } });
        await googleManager.update(HotelConnectivitySetup, { hotel_id: numericHotelId }, { setup_status: 0 });
      } else {
        const hIdStr = String(hotelId);
        deletedSetups = await googleManager.find(HotelConnectivitySetup, { where: { hotel_code: hIdStr } });
        await googleManager.update(HotelConnectivitySetup, { hotel_code: hIdStr }, { setup_status: 0 });
      }

      if (deletedSetups.length > 0) {
        return { 
          shouldPush: false, 
          shouldTeardown: true, 
          hotelCode: deletedSetups[0].hotel_code, 
          flatData: deletedSetups, 
          deletedSetups 
        };
      }
      return null;
    }

    let hotel: Hotel | null;
    const numericHotelId = Number(hotelId);
    if (!isNaN(numericHotelId)) {
      hotel = await manager.findOne(Hotel, { where: { id: numericHotelId } });
    } else {
      hotel = await manager.findOne(Hotel, { where: { code: String(hotelId) } });
    }

    if (!hotel) return null;

    if (hotel.status !== 1) {
      const existingSetups = await googleManager.find(HotelConnectivitySetup, { where: { hotel_id: hotel.id } });
      if (existingSetups.length > 0) {
        await googleManager.update(HotelConnectivitySetup, { hotel_id: hotel.id }, { setup_status: 0 });
      }
      return {
        shouldPush: false,
        shouldTeardown: true,
        hotelCode: hotel.code,
        flatData: existingSetups,
        deletedSetups: existingSetups,
      };
    }

    // Auto-Bootstrap lintas-database
    await this.ensureSetupExists(hotel.id, queryRunner);

    if (updateType === 'ROOM_DELETE') {
      const deletedSetups = await googleManager.find(HotelConnectivitySetup, { where: { hotel_id: hotel.id, room_type_id: entityReference.roomId } });
      await googleManager.delete(HotelConnectivitySetup, { hotel_id: hotel.id, room_type_id: entityReference.roomId });
      (queryRunner as any).deletedSetups = deletedSetups; 
    } else if (updateType === 'RATE_PLAN_DELETE') {
      const deletedSetups = await googleManager.find(HotelConnectivitySetup, { where: { hotel_id: hotel.id, rate_plan_id: entityReference.rateId } });
      await googleManager.delete(HotelConnectivitySetup, { hotel_id: hotel.id, rate_plan_id: entityReference.rateId });
      (queryRunner as any).deletedSetups = deletedSetups;
    } else if (['HOTEL_UPDATE', 'ROOM_UPDATE', 'RATE_PLAN_UPDATE'].includes(updateType)) {
      let filterSql = '';
      const params: any[] = [hotel.id];

      if (updateType === 'ROOM_UPDATE') {
        filterSql = 'AND rt.id = ?';
        params.push(entityReference.roomId);
      } else if (updateType === 'RATE_PLAN_UPDATE') {
        filterSql = 'AND rp.id = ?';
        params.push(entityReference.rateId);
      }

      // 1. Tarik dari Core DB
      const masterData = await this.coreDataSource.query(
        `SELECT 
          h.id, h.code, h.name, COALESCE(cat.category_name, 'N/A') as cat_name, COALESCE(br.brand_name, 'N/A') as brand_name,
          h.street_address, h.area, h.region, h.zip_code, h.latitude, h.longitude, h.phone,
          rt.id as rt_id, rt.name as rt_name, rt.guest, rt.smoking, rt.view,
          (SELECT filename FROM tb_hotel_image img WHERE img.hotel_id = h.id AND img.room_type_id = rt.id AND img.type = 1 LIMIT 1) as room_img,
          rp.id as rp_id, rp.name as rp_name, rp.food, rp.pay_at_hotel
        FROM tb_hotel h
        LEFT JOIN ms_property_category cat ON h.property_category = cat.id
        LEFT JOIN ms_brand br ON h.property_brand = br.id
        JOIN tb_hotel_room_type rt ON rt.hotel_id = h.id
        JOIN tb_hotel_rate_plan rp ON rp.room_type_id = rt.id
        WHERE h.id = ? AND h.status = 1 ${filterSql}`,
        params
      );

      // 2. Simpan ke Google DB
      for (const row of masterData) {
        await googleManager.query(
          `INSERT INTO tb_hotel_connectivity_setup (
            hotel_id, hotel_code, hotel_name, property_category, hotel_brand,
            street_address, city, province, zip_code, country, latitude, longitude, phone,
            room_type_id, room_type_name, room_capacity, room_smoking, room_view, room_image_url,
            rate_plan_id, rate_plan_name, breakfast_included, pay_at_hotel, setup_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            hotel_name = VALUES(hotel_name), property_category = VALUES(property_category),
            hotel_brand = VALUES(hotel_brand), street_address = VALUES(street_address),
            city = VALUES(city), province = VALUES(province), latitude = VALUES(latitude),
            longitude = VALUES(longitude), phone = VALUES(phone), room_type_name = VALUES(room_type_name),
            room_capacity = VALUES(room_capacity), room_smoking = VALUES(room_smoking), room_view = VALUES(room_view),
            room_image_url = VALUES(room_image_url), rate_plan_name = VALUES(rate_plan_name),
            breakfast_included = VALUES(breakfast_included), pay_at_hotel = VALUES(pay_at_hotel), updated_at = NOW()`,
          [
            row.id, row.code, row.name, row.cat_name, row.brand_name,
            row.street_address, row.area, row.region, row.zip_code,
            row.latitude, row.longitude, row.phone,
            row.rt_id, row.rt_name, row.guest, row.smoking, row.view, row.room_img,
            row.rp_id, row.rp_name, row.food, row.pay_at_hotel
          ]
        );
      }
    }

    const flatData = await googleManager.find(HotelConnectivitySetup, {
      where: { hotel_code: hotel.code },
    });

    const wasActive = flatData.some(row => row.setup_status === 1);
    const isAllValid = flatData.length > 0 && flatData.every((row: HotelConnectivitySetup) => this.validateGatekeeper(row) === 1);

    if (!isAllValid) {
      await googleManager.update(HotelConnectivitySetup, { hotel_code: hotel.code }, { setup_status: 0 });
      return { 
        shouldPush: false, 
        shouldTeardown: wasActive,
        hotelCode: hotel.code, 
        flatData, 
        deletedSetups: (queryRunner as any).deletedSetups || [],
      };
    }

    await googleManager.update(HotelConnectivitySetup, { hotel_code: hotel.code }, { setup_status: 1 });
    const activeFlatData = flatData.map((row) => ({ ...row, setup_status: 1, setupStatus: 1 }));

    return {
      shouldPush: true,
      shouldTeardown: false, // <-- Menghilangkan nilai undefined pada log
      hotelCode: hotel.code,
      flatData: activeFlatData,
      deletedSetups: (queryRunner as any).deletedSetups || [],
      roomTypeId: entityReference.roomId,
      ratePlanId: entityReference.rateId,
    };
  }

  async executeExternalPush(
    hotelCode: string,
    flatData: any[],
    updateType: string,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<void> {
    this.logger.log(`[EXTERNAL PUSH DISABLED] Skipping static profile feeds for hotel: ${hotelCode}`);
  }

  async executeTeardown(hotelCode: string, flatData: any[]): Promise<void> {
    const horizonMonths = parseInt(this.configService.get('ROLLING_HORIZON_MONTHS', '3'), 10);
    const today = new Date();
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + horizonMonths);

    const combinations = flatData.map(row => ({
      date: today,
      endDate: endDate,
      room_type_id: row.room_type_id,
      rate_plan_id: row.rate_plan_id,
      restriction_master: 1,
      set_min_los: 1 
    }));

    if (combinations.length > 0) {
      const availXml = AvailabilityBuilder.buildAvailNotifRQ(hotelCode, combinations);
      await this.googleApiService.pushPayload(hotelCode, availXml, 'Avail (Teardown)');
    }
  }

  private validateGatekeeper(row: any): number {
    if (!row) return 0;
    const isHotelValid = [row.hotel_code, row.hotel_name, row.street_address, row.city, row.province, row.phone]
      .every(field => field && field.toString().trim() !== '');
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    const isGeoValid = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
    const isRoomValid = row.room_type_id && row.room_type_name && Number(row.room_capacity) > 0;
    const isRateValid = row.rate_plan_id && row.rate_plan_name;
    return (isHotelValid && isGeoValid && isRoomValid && isRateValid) ? 1 : 0;
  }

  private async ensureSetupExists(hotelId: number, queryRunner: QueryRunner): Promise<void> {
    const googleManager = this.googleDataSource.manager;
    const existing = await googleManager.query(
      `SELECT hotel_code FROM tb_hotel_connectivity_setup WHERE hotel_id = ? LIMIT 1`,
      [hotelId]
    );

    if (existing.length === 0) {
      const masterData = await this.coreDataSource.query(
        `SELECT 
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
        WHERE h.id = ?`,
        [hotelId]
      );

      for (const row of masterData) {
        await googleManager.query(
          `INSERT INTO tb_hotel_connectivity_setup 
          (hotel_id, hotel_code, hotel_name, property_category, hotel_brand, street_address, city, province, zip_code, country, latitude, longitude, phone,
           room_type_id, room_type_name, room_capacity, room_smoking, room_view, room_image_url,
           rate_plan_id, rate_plan_name, breakfast_included, pay_at_hotel, setup_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            row.id, row.code, row.name, row.category_name || 'N/A', row.brand_name || 'N/A',
            row.street_address, row.city, row.province, row.zip_code, row.country,
            row.latitude, row.longitude, row.phone,
            row.room_id, row.room_name, row.capacity, row.smoking, row.view, row.room_image,
            row.rate_id, row.rate_name, row.food, row.pay_at_hotel,
          ]
        );
      }
    }
  }
}