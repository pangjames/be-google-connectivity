import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GoogleSyncService } from './google-sync.service';

@Injectable()
export class EventHandlerService {
  private readonly logger = new Logger(EventHandlerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly googleSyncService: GoogleSyncService,
  ) {}

  async handleRateChange(
    hotelCode: string,
    roomTypeId: number,
    ratePlanId: number,
    startDate: string,
    endDate: string,
    newRate: number,
  ) {
    this.logger.log(`Handling RATE_CHANGE for ${hotelCode} room=${roomTypeId} rate=${ratePlanId} (${startDate} to ${endDate})`);

    // Pinpoint UPDATE on the master table (tb_hotel_rate_custom) to prevent Race Condition
    // Materializer will pick this up when BullMQ executes it.
    const query = `
      INSERT INTO tb_hotel_rate_custom (date, rate_plan_id, rate, create_user, create_date, update_user, update_date)
      WITH RECURSIVE date_range AS (
        SELECT DATE(?) AS date
        UNION ALL
        SELECT DATE_ADD(date, INTERVAL 1 DAY)
        FROM date_range
        WHERE date < DATE(?)
      )
      SELECT 
        dr.date, 
        ? AS rate_plan_id, 
        ? AS rate, 
        'system' AS create_user, 
        NOW() AS create_date,
        'system' AS update_user,
        NOW() AS update_date
      FROM date_range dr
      ON DUPLICATE KEY UPDATE
        rate = VALUES(rate),
        update_user = VALUES(update_user),
        update_date = VALUES(update_date);
    `;

    await this.dataSource.query(query, [startDate, endDate, ratePlanId, newRate]);

    // Queue high-priority sync to Google for affected date range
    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1,
    });
  }

  async handleRestrictionChange(
    hotelCode: string,
    roomTypeId: number,
    ratePlanId: number,
    startDate: string,
    endDate: string,
    isOpen: boolean,
    restrictionType: 'master' | 'arrival' | 'departure' = 'master',
  ) {
    this.logger.log(`Handling RESTRICTION_CHANGE (${restrictionType}) for ${hotelCode} room=${roomTypeId} rate=${ratePlanId} (${startDate} to ${endDate})`);

    // DB convention: 0=Open, 1=Closed (tb_hotel_rate_custom stop_sell)
    const statusValue = isOpen ? 0 : 1;
    
    let columnName = 'stop_sell';
    if (restrictionType === 'arrival') columnName = 'cta';
    if (restrictionType === 'departure') columnName = 'ctd';

    // Pinpoint UPDATE on the master table (tb_hotel_rate_custom) to prevent Race Condition
    // Materializer will pick this up when BullMQ executes it.
    const query = `
      INSERT INTO tb_hotel_rate_custom (date, rate_plan_id, ${columnName}, create_user, create_date, update_user, update_date)
      WITH RECURSIVE date_range AS (
        SELECT DATE(?) AS date
        UNION ALL
        SELECT DATE_ADD(date, INTERVAL 1 DAY)
        FROM date_range
        WHERE date < DATE(?)
      )
      SELECT 
        dr.date, 
        ? AS rate_plan_id, 
        ? AS ${columnName}, 
        'system' AS create_user, 
        NOW() AS create_date,
        'system' AS update_user,
        NOW() AS update_date
      FROM date_range dr
      ON DUPLICATE KEY UPDATE
        ${columnName} = VALUES(${columnName}),
        update_user = VALUES(update_user),
        update_date = VALUES(update_date);
    `;

    await this.dataSource.query(query, [startDate, endDate, ratePlanId, statusValue]);

    // Queue high-priority sync to Google for affected date range
    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1,
    });
  }
}
