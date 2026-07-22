import { Injectable, Logger } from '@nestjs/common';
import { HotelPromotion } from '../../common/entities/hotel-promotion.entity';
import { PromotionBuilder } from '../builders/promotion.builder';

@Injectable()
export class PromotionMaterializerService {
  private readonly logger = new Logger(PromotionMaterializerService.name);

  materialize(hotelCode: string, dbData: HotelPromotion, actionOverride?: string): string {
    this.logger.log(`Materializing Promotion XML for hotel ${hotelCode} - PromoID: ${dbData.id}`);

    const todayStr = new Date().toISOString().split('T')[0];

    if (actionOverride === 'delete') {
      return PromotionBuilder.buildDeletePromotionRQ(hotelCode, dbData.id);
    }

    // Validasi Blackout Tipe 0 (Booking Date Blackout) hari ini
    const blackoutBookings = dbData.blackouts
      ?.filter((b) => Number(b.type) === 0)
      .map((b) => this.formatDateString(b.date_blackout)) || [];

    if (blackoutBookings.includes(todayStr)) {
      this.logger.warn(`Promo ID ${dbData.id} di-skip karena hari ini (${todayStr}) adalah Booking Blackout (Tipe 0). Memicu aksi delete.`);
      return PromotionBuilder.buildDeletePromotionRQ(hotelCode, dbData.id);
    }

    // Jalankan Algoritma Date Splitting untuk Blackout Tipe 1 (Stay Date)
    const splitStayRanges = this.splitStayDates(dbData.stay_start_date, dbData.stay_end_date, dbData.blackouts || []);

    return PromotionBuilder.buildPromotionRQ(hotelCode, dbData, splitStayRanges);
  }

  private splitStayDates(stayStart: string, stayEnd: string, blackouts: any[]): { start: string; end: string }[] {
    const stayBlackoutDates = blackouts
      .filter((b) => Number(b.type) === 1)
      .map((b) => this.formatDateString(b.date_blackout))
      .sort();

    const startStr = this.formatDateString(stayStart);
    const endStr = this.formatDateString(stayEnd);

    if (stayBlackoutDates.length === 0 || !startStr || !endStr) {
      return [{ start: startStr, end: endStr }];
    }

    const ranges: { start: string; end: string }[] = [];
    const blackoutSet = new Set(stayBlackoutDates);

    let loopDate = new Date(startStr);
    const finalEndDate = new Date(endStr);
    let rangeStartStr = startStr;

    while (loopDate <= finalEndDate) {
      const dateStr = this.formatDateString(loopDate);

      if (blackoutSet.has(dateStr)) {
        const prevDate = new Date(loopDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = this.formatDateString(prevDate);

        if (rangeStartStr <= prevDateStr) {
          ranges.push({ start: rangeStartStr, end: prevDateStr });
        }

        const nextDate = new Date(loopDate);
        nextDate.setDate(nextDate.getDate() + 1);
        rangeStartStr = this.formatDateString(nextDate);
      }

      loopDate.setDate(loopDate.getDate() + 1);
    }

    if (rangeStartStr <= endStr) {
      ranges.push({ start: rangeStartStr, end: endStr });
    }

    return ranges;
  }

  private formatDateString(val: any): string {
    if (!val) return '';
    if (typeof val === 'string') return val.split('T')[0];
    if (val instanceof Date) {
      const year = val.getFullYear();
      const month = String(val.getMonth() + 1).padStart(2, '0');
      const day = String(val.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return String(val);
  }
}