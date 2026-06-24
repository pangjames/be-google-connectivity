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

    // Pinpoint UPDATE using numeric IDs as per actual DB schema
    const query = `
      UPDATE tb_hotel_calendar_inventory c
      SET c.total_amount_after_tax = ?
      WHERE c.hotel_code = ?
        AND c.room_type_id = ?
        AND c.rate_plan_id = ?
        AND c.date BETWEEN ? AND ?
    `;

    await this.dataSource.query(query, [newRate, hotelCode, roomTypeId, ratePlanId, startDate, endDate]);

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

    // DB convention: 1=Open, 0=Closed (matching actual tb_hotel_rate_custom stop_sell: 0=Open, 1=Closed)
    const statusValue = isOpen ? 1 : 0;
    
    let columnName = 'restriction_master';
    if (restrictionType === 'arrival') columnName = 'restriction_arrival';
    if (restrictionType === 'departure') columnName = 'restriction_departure';

    // Pinpoint UPDATE using numeric IDs — no need to JOIN room_type/rate_plan tables
    const query = `
      UPDATE tb_hotel_calendar_inventory c
      SET c.${columnName} = ?
      WHERE c.hotel_code = ?
        AND c.room_type_id = ?
        AND c.rate_plan_id = ?
        AND c.date BETWEEN ? AND ?
    `;

    await this.dataSource.query(query, [statusValue, hotelCode, roomTypeId, ratePlanId, startDate, endDate]);

    // Queue high-priority sync to Google for affected date range
    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1,
    });
  }
}
