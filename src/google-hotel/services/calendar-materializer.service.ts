import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';

@Injectable()
export class CalendarMaterializerService {
  private readonly logger = new Logger(CalendarMaterializerService.name);

  constructor(
    @InjectDataSource() private readonly coreDataSource: DataSource, // Default (Core)
    @InjectDataSource('googleConnection') private readonly googleDataSource: DataSource // Google DB
  ) {}

  async materialize(
    hotelCode: string, 
    startDate: string, 
    endDate: string,
    queryRunner?: QueryRunner,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<void> {
    if (!hotelCode || !startDate || !endDate) return;

    const qrGoogle = this.googleDataSource.createQueryRunner();
    await qrGoogle.connect();
    await qrGoogle.startTransaction();

    try {
      // 1. Ambil setup aktif dari DB Google
      let setupQuery = `SELECT hotel_id, room_type_id, rate_plan_id FROM tb_hotel_connectivity_setup WHERE hotel_code = ? AND setup_status = 1`;
      const setupParams: any[] = [hotelCode];
      
      if (roomTypeId) { setupQuery += ` AND room_type_id = ?`; setupParams.push(roomTypeId); }
      if (ratePlanId) { setupQuery += ` AND rate_plan_id = ?`; setupParams.push(ratePlanId); }
      
      const activeSetups = await qrGoogle.query(setupQuery, setupParams);
      if (activeSetups.length === 0) {
        await qrGoogle.commitTransaction();
        return;
      }

      const hotelId = activeSetups[0].hotel_id;

      // 2. Ambil data Core (Master Room, Rate, Custom) dari DB Core
      const masterRooms = await this.coreDataSource.query(`SELECT id, room_qty, guest FROM tb_hotel_room_type WHERE hotel_code = ?`, [hotelCode]);
      const masterRates = await this.coreDataSource.query(`SELECT id, room_type_id, rate, min_night FROM tb_hotel_rate_plan WHERE hotel_id = ?`, [hotelId]);
      const customRates = await this.coreDataSource.query(`SELECT rate_plan_id, date, rate, room_qty, stop_sell, cta, ctd, min_stay FROM tb_hotel_rate_custom WHERE date BETWEEN ? AND ?`, [startDate, endDate]);

      // 3. Looping Tanggal via Node.js
      const start = new Date(startDate);
      const end = new Date(endDate);
      const bulkInsertData = [];

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const dateStr = String(d.getDate()).padStart(2, '0');
        const currentDate = `${year}-${month}-${dateStr}`;

        for (const setup of activeSetups) {
          const room = masterRooms.find((r: any) => r.id === setup.room_type_id);
          const rate = masterRates.find((rp: any) => rp.id === setup.rate_plan_id);
          
          const custom = customRates.find((c: any) => {
            const cDate = c.date instanceof Date ? c.date : new Date(c.date);
            const cy = cDate.getFullYear();
            const cm = String(cDate.getMonth() + 1).padStart(2, '0');
            const cd = String(cDate.getDate()).padStart(2, '0');
            const cDateStr = `${cy}-${cm}-${cd}`;
            return c.rate_plan_id === setup.rate_plan_id && cDateStr === currentDate;
          });

          if (room && rate) {
            bulkInsertData.push([
              hotelId,
              hotelCode,
              setup.room_type_id,
              setup.rate_plan_id,
              currentDate,
              custom?.rate ?? rate.rate,
              custom?.room_qty ?? room.room_qty,
              custom?.stop_sell ?? 0,
              custom?.cta ?? 0,
              custom?.ctd ?? 0,
              custom?.min_stay ?? rate.min_night
            ]);
          }
        }
      }

      // 4. Batch Insert / Upsert ke Google DB
      for (const item of bulkInsertData) {
        await qrGoogle.query(
          `INSERT INTO tb_hotel_calendar_inventory (
            hotel_id, hotel_code, room_type_id, rate_plan_id, date,
            total_amount_after_tax, inv_count, restriction_master,
            restriction_arrival, restriction_departure, set_min_los
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            total_amount_after_tax = VALUES(total_amount_after_tax),
            inv_count = VALUES(inv_count),
            restriction_master = VALUES(restriction_master),
            restriction_arrival = VALUES(restriction_arrival),
            restriction_departure = VALUES(restriction_departure),
            set_min_los = VALUES(set_min_los)`,
          item
        );
      }

      await qrGoogle.commitTransaction();
      this.logger.log(`Successfully materialized calendar for ${hotelCode} from ${startDate} to ${endDate}`);
    } catch (error) {
      await qrGoogle.rollbackTransaction();
      this.logger.error(`Failed to materialize calendar for ${hotelCode}`, error);
      throw error;
    } finally {
      await qrGoogle.release();
    }
  }
}