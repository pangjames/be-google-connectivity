import { create } from 'xmlbuilder2';
import * as crypto from 'crypto';
import { HotelPromotion } from '../../common/entities/hotel-promotion.entity';

export class PromotionBuilder {
  private static getPartnerId(): string {
    return process.env.GOOGLE_PARTNER_ID || 'AZANA_CRM';
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
      .ele('Promotion', { id: dbData.id.toString() }); // Upsert Mode: Without action attribute on Promotion element

    // Booking Dates
    root.ele('BookingDates')
      .ele('DateRange', {
        start: formatIso(dbData.start_date),
        end: formatIso(dbData.end_date),
      })
      .up()
      .up();

    // Stay Dates with application="overlap"
    const stayDatesNode = root.ele('StayDates', { application: 'overlap' });
    for (const range of splitStayRanges) {
      stayDatesNode.ele('DateRange', { start: range.start, end: range.end });
    }
    stayDatesNode.up();

    // Room Types & Rate Plans Mapping
    // Process applies ONLY IF role === 1 (Specific Hotel / Whitelist).
    // If role === 0, applies contains exclusion/blacklist items and should not be mapped as target promotion elements.
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

    // Discount Type (0 = percentage, 1 = fixed_amount)
    Number(dbData.type) === 0
      ? root.ele('Discount', { percentage: Number(dbData.discount_value).toString() })
      : root.ele('Discount', { fixed_amount: Number(dbData.discount_value).toString() });

    // Floor (Minimum Transaction)
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