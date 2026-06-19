import { create } from 'xmlbuilder2';
import { HotelCalendarInventory } from '../../common/entities/hotel-calendar-inventory.entity';

export class RateBuilder {
  static buildRateAmountNotifRQ(
    hotelCode: string,
    inventories: any[],
  ): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('OTA_HotelRateAmountNotifRQ', {
        xmlns: 'http://www.opentravel.org/OTA/2003/05',
        Version: '3.0',
      })
      .ele('RateAmountMessages', { HotelCode: hotelCode });

    for (const inv of inventories) {
      // For each day/room/plan, we add a RateAmountMessage
      root
        .ele('RateAmountMessage')
          .ele('StatusApplicationControl', {
            Start: inv.date.toISOString().split('T')[0],
            End: inv.date.toISOString().split('T')[0],
            InvTypeCode: inv.room_type_id.toString(),
            RatePlanCode: inv.rate_plan_id.toString(),
          }).up()
          .ele('Rates')
            .ele('Rate')
              .ele('BaseByGuestAmts')
                .ele('BaseByGuestAmt', {
                  AmountAfterTax: inv.total_amount_after_tax.toString(),
                  CurrencyCode: 'IDR', // Hardcoded IDR or get from hotel setting
                  NumberOfGuests: inv.capacity.toString(),
                }).up()
              .up()
            .up()
          .up()
        .up();
    }

    return root.end({ prettyPrint: true });
  }

  // A basic Transaction message for property/room/rateplan updates
  // Usually this is pushed when base data changes, not daily.
  static buildTransactionMessage(
    hotelCode: string,
    roomTypes: any[],
    ratePlans: any[],
  ): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Transaction', {
        timestamp: new Date().toISOString(),
        id: `tx-${Date.now()}`,
      })
      .ele('PropertyDataSet')
        .ele('Property', { id: hotelCode }).up()
        .ele('RoomData');

    for (const rt of roomTypes) {
      root.ele('RoomData', { id: rt.id.toString() })
        .ele('Name')
          .ele('Text', { text: rt.name }).up()
        .up()
        .ele('Capacity', { val: rt.guest.toString() }).up()
      .up();
    }
    
    root.up().ele('PackageData');
    
    for (const rp of ratePlans) {
      root.ele('PackageData', { id: rp.id.toString() })
        .ele('Name')
          .ele('Text', { text: rp.name }).up()
        .up()
      .up();
    }

    return root.end({ prettyPrint: true });
  }
}
