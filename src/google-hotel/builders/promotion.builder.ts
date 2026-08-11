import { create } from 'xmlbuilder2';
import * as crypto from 'crypto';
import { HotelPromotion } from '../../common/entities/hotel-promotion.entity';

export class PromotionBuilder {
  private static getPartnerId(): string {
    return process.env.GOOGLE_PARTNER_ID || 'AZANA_CRM';
  }

  /**
   * Parser to convert a cron format string like "* * * * 4,5,6" into Google's days_of_week string.
   * Standard Cron DOW Format: 0/7=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
   * Google Promotions API Format: M=Mon, T=Tue, W=Wed, H=Thu, F=Fri, S=Sat, U=Sun
   */
  private static parseCronDays(cronStr: string | null): string | null {
    if (!cronStr || cronStr.trim() === '' || cronStr.trim() === '*') return null;

    const parts = cronStr.trim().split(' ');
    // If it does not reach 5 segments (not a cron format), assume it applies every day
    if (parts.length < 5) return null; 

    const dowPart = parts[4]; // The 5th segment is the Day of Week specifier
    if (dowPart === '*') return null; 

    const dowArray = dowPart.split(',');
    let daysOfWeek = '';

    if (dowArray.includes('1')) daysOfWeek += 'M'; // Monday
    if (dowArray.includes('2')) daysOfWeek += 'T'; // Tuesday
    if (dowArray.includes('3')) daysOfWeek += 'W'; // Wednesday
    if (dowArray.includes('4')) daysOfWeek += 'H'; // Thursday (Google uses 'H')
    if (dowArray.includes('5')) daysOfWeek += 'F'; // Friday
    if (dowArray.includes('6')) daysOfWeek += 'S'; // Saturday
    if (dowArray.includes('0') || dowArray.includes('7')) daysOfWeek += 'U'; // Sunday (Google uses 'U')

    return daysOfWeek.length > 0 ? daysOfWeek : null;
  }

  static buildPromotionRQ(
    hotelCode: string,
    dbData: HotelPromotion,
    splitStayRanges: { start: string; end: string }[],
  ): string {
    const formatIso = (val: any) => {
      if (!val) return '';
      return (val instanceof Date ? val : new Date(val)).toISOString().split('T')[0];
    };

    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Promotions', {
        partner: this.getPartnerId(),
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      })
      .ele('HotelPromotions', { hotel_id: hotelCode })
      .ele('Promotion', { id: dbData.id.toString() }); 

    // -------------------------------------------------------------
    // 1. Booking Dates with days_of_week attribute
    // -------------------------------------------------------------
    const bookingDatesNode = root.ele('BookingDates');
    const bookingDowStr = this.parseCronDays(dbData.booking_days);
    
    const bookingDateRangeAttr: Record<string, string> = {
      start: formatIso(dbData.start_date),
      end: formatIso(dbData.end_date),
    };
    // Append days_of_week attribute only if cron string exists
    if (bookingDowStr) {
      bookingDateRangeAttr.days_of_week = bookingDowStr;
    }
    
    bookingDatesNode.ele('DateRange', bookingDateRangeAttr);
    bookingDatesNode.up(); // Close BookingDates element

    // -------------------------------------------------------------
    // 2. Stay Dates with days_of_week attribute
    // -------------------------------------------------------------
    const stayDatesNode = root.ele('StayDates', { application: 'overlap' });
    const stayDowStr = this.parseCronDays(dbData.stay_days);
    
    for (const range of splitStayRanges) {
      const stayDateRangeAttr: Record<string, string> = { 
        start: range.start, 
        end: range.end 
      };
      // Append days_of_week attribute only if cron string exists
      if (stayDowStr) {
        stayDateRangeAttr.days_of_week = stayDowStr;
      }
      stayDatesNode.ele('DateRange', stayDateRangeAttr);
    }
    
    stayDatesNode.up(); // Close StayDates element

    // -------------------------------------------------------------
    // 3. Room Types & Rate Plans Mapping
    // -------------------------------------------------------------
    if (Number(dbData.role) === 1 && dbData.applies && dbData.applies.length > 0) {
      const roomTypeIds = dbData.applies.filter((app) => app.room_type_id).map((app) => app.room_type_id);
      if (roomTypeIds.length > 0) {
        const roomTypesNode = root.ele('RoomTypes');
        roomTypeIds.forEach((id) => {
          roomTypesNode.ele('RoomType', { id: id!.toString() });
        });
        roomTypesNode.up();
      }

      const ratePlanIds = dbData.applies.filter((app) => app.rate_plan_id).map((app) => app.rate_plan_id);
      if (ratePlanIds.length > 0) {
        const ratePlansNode = root.ele('RatePlans');
        ratePlanIds.forEach((id) => {
          ratePlansNode.ele('RatePlan', { id: id!.toString() });
        });
        ratePlansNode.up();
      }
    }

    // -------------------------------------------------------------
    // 4. Discount & Floor Logic
    // -------------------------------------------------------------
    Number(dbData.type) === 0
      ? root.ele('Discount', { percentage: Number(dbData.discount_value).toString() })
      : root.ele('Discount', { fixed_amount: Number(dbData.discount_value).toString() });

    if (dbData.trx_min && Number(dbData.trx_min) > 0) {
      root.ele('Floor', { amount_per_night: Number(dbData.trx_min).toString() });
    }

    return root.end({ prettyPrint: true });
  }

  static buildDeletePromotionRQ(hotelCode: string, promotionId: number): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Promotions', {
        partner: this.getPartnerId(),
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      })
      .ele('HotelPromotions', { hotel_id: hotelCode })
      .ele('Promotion', { id: promotionId.toString(), action: 'delete' });

    return root.end({ prettyPrint: true });
  }
}