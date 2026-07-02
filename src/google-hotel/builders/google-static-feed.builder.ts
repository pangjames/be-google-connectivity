import { Injectable } from '@nestjs/common';
import * as create from 'xmlbuilder2';

@Injectable()
export class GoogleStaticFeedBuilder {

  /**
   * Builds the Hotel List Feed XML payload based on flat database rows.
   */
  static buildHotelListFeed(flatData: any[]): string {
    const root = create.create({ version: '1.0', encoding: 'UTF-8' })
      .ele('HotelFeed', { xmlns: 'http://www.google.com/schemas/travel/v2/HotelFeed' });

    // Filter to ensure unique hotel properties are only listed once
    const distinctHotels = Array.from(new Set(flatData.map(h => h.hotel_code)))
      .map(code => flatData.find(h => h.hotel_code === code));

    for (const hotel of distinctHotels) {
      root.ele('Hotel')
        .ele('ID').txt(hotel.hotel_code).up()
        .ele('Name').txt(hotel.hotel_name).up()
        .ele('Address', { format: 'simple' })
          .ele('StreetAddress').txt(hotel.street_address).up()
          .ele('City').txt(hotel.city).up()
          .ele('Province').txt(hotel.province).up()
          .ele('Country').txt('ID').up()
        .up()
        .ele('Contact').ele('Phone').txt(hotel.phone).up().up()
        .ele('Geocode')
          .ele('Latitude').txt(hotel.latitude).up()
          .ele('Longitude').txt(hotel.longitude).up()
        .up();
    }
    return root.end({ prettyPrint: true });
  }

  /**
   * Builds the Transaction Metadata XML payload for rooms and packages.
   */
  static buildTransactionMetadata(hotelCode: string, flatData: any[]): string {
    const root = create.create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Transaction');

    const propertyDataSet = root.ele('PropertyDataSet');
    propertyDataSet.ele('Property').txt(hotelCode);

    // Extract and map distinct room types
    const distinctRooms = Array.from(new Set(flatData.map(r => r.room_type_id)))
      .map(id => flatData.find(r => r.room_type_id === id));

    for (const room of distinctRooms) {
      propertyDataSet.ele('RoomData')
        .ele('RoomID').txt(room.room_type_id.toString()).up()
        .ele('Name').ele('Text', { language: 'id' }).txt(room.room_type_name).up().up()
        .ele('Capacity').txt(room.room_capacity.toString()).up();
    }

    // Extract and map distinct rate plans
    const distinctRates = Array.from(new Set(flatData.map(p => p.rate_plan_id)))
      .map(id => flatData.find(p => p.rate_plan_id === id));

    for (const rate of distinctRates) {
      propertyDataSet.ele('PackageData')
        .ele('PackageID').txt(rate.rate_plan_id.toString()).up()
        .ele('Name').ele('Text', { language: 'id' }).txt(rate.rate_plan_name).up().up();
    }

    return root.end({ prettyPrint: true });
  }
}