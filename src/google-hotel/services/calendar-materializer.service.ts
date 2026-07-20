import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';

@Injectable()
export class CalendarMaterializerService {
  private readonly logger = new Logger(CalendarMaterializerService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Materializes relational data into the flat tb_hotel_calendar_inventory table
   * using a database transaction to ensure atomicity.
   */
  async materialize(
    hotelCode: string, 
    startDate: string, 
    endDate: string,
    queryRunner?: QueryRunner,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<void> {
    this.logger.log(`Materializing calendar for hotel ${hotelCode} from ${startDate} to ${endDate}`);

    let localQueryRunner = false;
    let qr = queryRunner;

    if (!qr) {
      // Initialize a local query runner if not provided externally
      qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      localQueryRunner = true;
    }

    let filterConditions = "";
    const queryParams: any[] = [startDate, endDate, hotelCode];

    // Add specific filters if IDs are provided
    if (roomTypeId) {
      filterConditions += " AND rt.id = ?";
      queryParams.push(roomTypeId);
    }
    if (ratePlanId) {
      filterConditions += " AND rp.id = ?";
      queryParams.push(ratePlanId);
    }

    const query = `
      INSERT INTO tb_hotel_calendar_inventory (
        hotel_id,
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
        th.id AS hotel_id,
        th.code AS hotel_code,
        rt.id AS room_type_id,
        rp.id AS rate_plan_id,
        dr.date,
        COALESCE(rc.rate, rp.rate) AS total_amount_after_tax,
        COALESCE(rc.room_qty, rt.room_qty) AS inv_count,
        IFNULL(rc.stop_sell, 0) as restriction_master,
        IFNULL(rc.cta, 0) as restriction_arrival,
        IFNULL(rc.ctd, 0) as restriction_departure,
        COALESCE(rc.min_stay, rp.min_night) as set_min_los
      FROM tb_hotel_room_type rt
      LEFT JOIN tb_hotel th ON rt.hotel_id = th.id
      LEFT JOIN tb_hotel_rate_plan rp ON rp.room_type_id = rt.id
      CROSS JOIN date_range dr
      LEFT JOIN tb_hotel_rate_custom rc
        ON rc.rate_plan_id = rp.id AND rc.date = dr.date
      WHERE th.code = ? ${filterConditions}
      ON DUPLICATE KEY UPDATE
        total_amount_after_tax = VALUES(total_amount_after_tax),
        inv_count = VALUES(inv_count),
        restriction_master = VALUES(restriction_master),
        restriction_arrival = VALUES(restriction_arrival),
        restriction_departure = VALUES(restriction_departure),
        set_min_los = VALUES(set_min_los);
    `;

    try {
      // Execute query using the active runner
      await qr.query(query, queryParams);
      
      if (localQueryRunner) {
        // Commit changes permanently if created locally
        await qr.commitTransaction();
        this.logger.log(`Successfully materialized calendar for ${hotelCode}`);
      }

    } catch (error) {
      this.logger.error(`Failed to materialize calendar for ${hotelCode}. Rolling back transaction.`, error.stack);
      if (localQueryRunner) {
        // Rollback all changes if created locally
        await qr.rollbackTransaction();
      }
      
      // Throw error to trigger SQS auto-retry and DLQ mechanism
      throw error;
      
    } finally {
      if (localQueryRunner) {
        // Release connection back to the pool if created locally
        await qr.release();
      }
    }
  }
}
