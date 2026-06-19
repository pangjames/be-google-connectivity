import { create } from 'xmlbuilder2';
import { HotelCalendarInventory } from '../../common/entities/hotel-calendar-inventory.entity';

export class AvailabilityBuilder {
  static buildAvailNotifRQ(
    hotelCode: string,
    inventories: any[],
  ): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('OTA_HotelAvailNotifRQ', {
        xmlns: 'http://www.opentravel.org/OTA/2003/05',
        Version: '3.0',
      })
      .ele('AvailStatusMessages', { HotelCode: hotelCode });

    for (const inv of inventories) {
      root
        .ele('AvailStatusMessage')
          .ele('StatusApplicationControl', {
            Start: inv.date.toISOString().split('T')[0],
            End: inv.date.toISOString().split('T')[0],
            InvTypeCode: inv.room_type_id.toString(),
            RatePlanCode: inv.rate_plan_id.toString(),
          }).up()
          .ele('LengthsOfStay')
            .ele('LengthOfStay', {
              Time: inv.set_min_los.toString(),
              TimeUnit: 'Day',
              MinMaxMessageType: 'MinLOS',
            }).up()
          .up()
          .ele('RestrictionStatus', {
            Status: inv.restriction_master === 0 ? 'Close' : 'Open',
            Restriction: 'Master',
          }).up()
        .up();
    }

    return root.end({ prettyPrint: true });
  }
}
