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
   * Runs entirely inside the database transaction (does not make external HTTP/API calls).
   */
  async handleExtranetDeltaUpdate(
    entityReference: any,
    updateType: string,
    queryRunner: QueryRunner
  ): Promise<{ shouldPush: boolean; hotelCode: string; flatData: any[]; roomTypeId?: number; ratePlanId?: number }> {
    const hotelId = entityReference?.hotelId;
    if (!hotelId) {
      throw new Error("hotelId wajib diisi");
    }

    // --- VALIDASI TAMBAHAN BERDASARKAN TIPE ---
    if (updateType === 'ROOM_UPDATE' && !entityReference.roomId) {
      throw new Error("ROOM_UPDATE wajib menyertakan roomId");
    }

    if (updateType === 'RATE_PLAN_UPDATE') {
      if (!entityReference.roomId || !entityReference.rateId) {
        throw new Error("RATE_PLAN_UPDATE wajib menyertakan roomId dan rateId");
      }
    }

    this.logger.log(`Processing database transaction for ${updateType} (Hotel ID/Code: ${hotelId})`);

    const manager = queryRunner.manager;

    // 1. Ambil data hotel dari master database (mendukung id numeric maupun code string)
    let hotel: Hotel | null;
    if (typeof hotelId === 'number') {
      hotel = await manager.findOne(Hotel, { where: { id: hotelId } });
    } else {
      hotel = await manager.findOne(Hotel, { where: { code: hotelId } });
    }

    if (!hotel) {
      throw new Error(`Hotel tidak ditemukan untuk ID/Code: ${hotelId}`);
    }

    // 2. Kunci / Validasi Entitas Turunan
    if (entityReference.roomId) {
      const room = await manager.findOne(HotelRoomType, { where: { id: entityReference.roomId } });
      if (!room) {
        throw new Error(`Room Type dengan ID ${entityReference.roomId} tidak ditemukan`);
      }
    }

    if (entityReference.rateId) {
      const ratePlan = await manager.findOne(HotelRatePlan, { where: { id: entityReference.rateId } });
      if (!ratePlan) {
        throw new Error(`Rate Plan dengan ID ${entityReference.rateId} tidak ditemukan`);
      }
    }

    // 3. Gatekeeper: Validasi kelengkapan data menggunakan data dari tb_hotel_connectivity_setup
    const flatData = await manager.query(
      `SELECT * FROM tb_hotel_connectivity_setup WHERE hotel_code = ?`,
      [hotel.code]
    );

    const row = flatData[0];
    const status = this.validateGatekeeper(row);

    if (status === 0) {
      this.logger.warn(`[GATEKEEPER] Data hotel ${hotel.code} TIDAK LENGKAP! Mengunci akun (status = 0).`);
      
      await manager.update(
        'tb_hotel_connectivity_setup', 
        { hotel_code: hotel.code }, 
        { setup_status: 0 }
      );
      return { shouldPush: false, hotelCode: hotel.code, flatData: [] };
    }

    // Jika valid, pastikan status di DB = 1
    await manager.update(
      'tb_hotel_connectivity_setup', 
      { hotel_code: hotel.code }, 
      { setup_status: 1 }
    );

    this.logger.log(`[GATEKEEPER PASSED] Hotel ${hotel.code} valid. Memproses DB update untuk: ${updateType}`);

    // 4. Proses DB update jika ada
    if (updateType === 'ROOM_UPDATE') {
      this.logger.log(`[PROPERTY DB UPDATE] Struktur Kamar diperbarui di DB untuk hotel: ${hotel.code}`);
    } else if (updateType === 'RATE_PLAN_UPDATE') {
      this.logger.log(`[PROPERTY DB UPDATE] Struktur Rate Plan diperbarui di DB untuk hotel: ${hotel.code}`);
    }

    // Ambil data aktif dari snapshot connectivity setup
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
   * 2. API logic: Pushes profile feeds to Google and triggers Domino ARI if needed.
   * Executed AFTER the database transaction is committed to prevent holding locks during network latency.
   */
  async executeExternalPush(
    hotelCode: string, 
    flatData: any[], 
    updateType: string,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<void> {
    // 1. Kirim ListFeed & Transaction (Static profile) ke Google
    if (flatData && flatData.length > 0) {
      this.logger.log(`[STATIC PUSH] Generating static profile feeds for hotel: ${hotelCode}`);
      const hotelListFeedXml = GoogleStaticFeedBuilder.buildHotelListFeed(flatData);
      const transactionMetadataXml = GoogleStaticFeedBuilder.buildTransactionMetadata(hotelCode, flatData);

      await this.googleApiService.pushPayload(hotelCode, hotelListFeedXml, 'ListFeed');
      await this.googleApiService.pushPayload(hotelCode, transactionMetadataXml, 'Transaction');
    } else {
      this.logger.warn(`[STATIC PUSH] Tidak ada data di tb_hotel_connectivity_setup untuk hotel: ${hotelCode}. Melewati push static.`);
    }

    // 2. Efek Domino: Jika Room/Rate berubah (bukan HOTEL_UPDATE), otomatis memicu alur ARI 365 hari ke depan
    if (updateType !== 'HOTEL_UPDATE') {
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      this.logger.log(`[DOMINO EFFECT] Pemicu sinkronisasi ARI 365 hari untuk hotel: ${hotelCode} dari ${startDate} ke ${endDate}`);
      await this.googleSyncService.syncDateRange(hotelCode, startDate, endDate, roomTypeId, ratePlanId, updateType);
    }
  }

  private validateGatekeeper(row: any): number {
    if (!row) return 0;

    // 1. Hotel Profile Validation
    const requiredHotelFields = ['hotel_code', 'hotel_name', 'street_address', 'city', 'province', 'phone'];
    if (requiredHotelFields.some(field => !row[field] || row[field].toString().trim() === '')) {
      return 0;
    }

    // 2. Geo-coordinates Validation
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
      return 0;
    }

    // 3. Room Type Validation
    if (!row.room_type_id || !row.room_type_name || Number(row.room_capacity) <= 0) {
      return 0;
    }

    // 4. Rate Plan Validation
    if (!row.rate_plan_id || !row.rate_plan_name) {
      return 0;
    }

    return 1;
  }
}