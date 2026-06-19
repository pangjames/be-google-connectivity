import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class CalendarMaterializerService {
  private readonly logger = new Logger(CalendarMaterializerService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Materializes the complex relational data into the flat tb_hotel_calendar_inventory table.
   */
  async materialize(hotelCode: string, startDate: string, endDate: string): Promise<void> {
    this.logger.log(`Materializing calendar for hotel ${hotelCode} from ${startDate} to ${endDate}`);

    const query = `
      INSERT INTO tb_hotel_calendar_inventory (
        hotel_code,
        room_type_id,
        rate_plan_id,
        date,
        total_amount_after_tax,
        inv_count,
        restriction_master,
        restriction_arrival,
        restriction_departure,
        set_min_los
      )
      WITH RECURSIVE date_range AS (
        SELECT DATE(?) AS date
        UNION ALL
        SELECT DATE_ADD(date, INTERVAL 1 DAY)
        FROM date_range
        WHERE date < DATE(?)
      )
      SELECT
        th.code AS hotel_code,
        rt.id AS room_type_id,
        rp.id AS rate_plan_id,
        dr.date,
        COALESCE(rc.rate, rp.rate) AS total_amount_after_tax,
        COALESCE(rc.room_qty, rt.room_qty) AS inv_count,
        IF(COALESCE(rc.stop_sell, 0)=0, 1, 0) as restriction_master,
        IF(COALESCE(rc.cta, 0)=0, 1, 0) as restriction_arrival,
        IF(COALESCE(rc.ctd, 0)=0, 1, 0) as restriction_departure,
        COALESCE(rc.min_stay, rp.min_night) as set_min_los
      FROM tb_hotel_room_type rt
      LEFT JOIN tb_hotel th ON rt.hotel_id = th.id
      LEFT JOIN tb_hotel_rate_plan rp ON rp.room_type_id = rt.id
      CROSS JOIN date_range dr
      LEFT JOIN tb_hotel_rate_custom rc
        ON rc.rate_plan_id = rp.id AND rc.date = dr.date
      WHERE th.code = ?
      ON DUPLICATE KEY UPDATE
        total_amount_after_tax = VALUES(total_amount_after_tax),
        inv_count = VALUES(inv_count),
        restriction_master = VALUES(restriction_master),
        restriction_arrival = VALUES(restriction_arrival),
        restriction_departure = VALUES(restriction_departure),
        set_min_los = VALUES(set_min_los);
    `;

    try {
      await this.dataSource.query(query, [startDate, endDate, hotelCode]);
      this.logger.log(`Successfully materialized calendar for ${hotelCode}`);
    } catch (error) {
      this.logger.error(`Failed to materialize calendar for ${hotelCode}`, error.stack);
      throw error;
    }
  }
}
