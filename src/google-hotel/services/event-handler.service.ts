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
    roomTypeCode: string,
    ratePlanCode: string,
    startDate: string,
    endDate: string,
    newRate: number,
  ) {
    this.logger.log(`Handling RATE_CHANGE for ${hotelCode} (${startDate} to ${endDate})`);

    // 1. Pinpoint UPDATE on the materialized table
    const query = `
      UPDATE tb_hotel_calendar_inventory c
      JOIN tb_hotel_room_type rt ON c.room_type_id = rt.id
      JOIN tb_hotel_rate_plan rp ON c.rate_plan_id = rp.id
      SET c.total_amount_after_tax = ?
      WHERE c.hotel_code = ?
        AND rt.code = ?
        AND rp.code = ?
        AND c.date BETWEEN ? AND ?
    `;

    await this.dataSource.query(query, [newRate, hotelCode, roomTypeCode, ratePlanCode, startDate, endDate]);

    // 2. Queue sync to Google
    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1, // High priority for live changes
    });
  }

  async handleRestrictionChange(
    hotelCode: string,
    roomTypeCode: string,
    ratePlanCode: string,
    startDate: string,
    endDate: string,
    isOpen: boolean,
  ) {
    this.logger.log(`Handling RESTRICTION_CHANGE for ${hotelCode} (${startDate} to ${endDate})`);

    const statusValue = isOpen ? 1 : 0;
    
    // Using Master restriction as an example
    const query = `
      UPDATE tb_hotel_calendar_inventory c
      JOIN tb_hotel_room_type rt ON c.room_type_id = rt.id
      JOIN tb_hotel_rate_plan rp ON c.rate_plan_id = rp.id
      SET c.restriction_master = ?
      WHERE c.hotel_code = ?
        AND rt.code = ?
        AND rp.code = ?
        AND c.date BETWEEN ? AND ?
    `;

    await this.dataSource.query(query, [statusValue, hotelCode, roomTypeCode, ratePlanCode, startDate, endDate]);

    await this.googleSyncService.syncDateRange({
      hotelCode,
      startDate,
      endDate,
      priority: 1,
    });
  }
}
