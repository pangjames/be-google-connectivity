import { create } from 'xmlbuilder2';


export class InventoryBuilder {
  static buildInvCountNotifRQ(
    hotelCode: string,
    inventories: any[],
  ): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('OTA_HotelInvCountNotifRQ', {
        xmlns: 'http://www.opentravel.org/OTA/2003/05',
        Version: '3.0',
      })
      .ele('Inventories', { HotelCode: hotelCode });

    for (const inv of inventories) {
      root
        .ele('Inventory')
          .ele('StatusApplicationControl', {
            Start: (inv.date instanceof Date ? inv.date : new Date(inv.date)).toISOString().split('T')[0],
            End: (inv.date instanceof Date ? inv.date : new Date(inv.date)).toISOString().split('T')[0],
            InvTypeCode: inv.room_type_id.toString(),
            // RatePlanCode is generally not needed for room inventory, but keeping it if OTA requires it
          }).up()
          .ele('InvCounts')
            .ele('InvCount', {
              CountType: '1', // 1 usually means total available
              Count: inv.inv_count.toString(),
            }).up()
          .up()
        .up();
    }

    return root.end({ prettyPrint: true });
  }
}
