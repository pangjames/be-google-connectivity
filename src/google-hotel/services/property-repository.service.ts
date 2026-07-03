import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../../common/entities/hotel.entity';
import { HotelRoomType } from '../../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../../common/entities/hotel-rate-plan.entity';

@Injectable()
export class PropertyRepositoryService {
  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepo: Repository<Hotel>,
    @InjectRepository(HotelRoomType)
    private readonly roomRepo: Repository<HotelRoomType>,
    @InjectRepository(HotelRatePlan)
    private readonly rateRepo: Repository<HotelRatePlan>,
  ) {}

  /**
   * Retrieves data hotel profile data from the master database.
   */
  async getMasterHotel(hotelId: number): Promise<any | null> {
    const result = await this.hotelRepo.createQueryBuilder('h')
      .leftJoin('ms_property_category', 'cat', 'h.property_category = cat.id')
      .leftJoin('ms_brand', 'b', 'h.property_brand = b.id')
      .select([
        'h.id as id',
        'h.code as hotel_code',
        'h.name as hotel_name',
        'cat.category_name as property_category', 
        'b.brand_name as hotel_brand',            
        'h.street_address as street_address',
        'h.region as city', 
        'h.area as province', 
        'h.zip_code as zip_code',
        'h.phone as phone',
        'h.latitude as latitude',
        'h.longitude as longitude'
      ])
      .where('h.id = :hotelId', { hotelId })
      .getRawOne();

    return result || null;
  }

  /**
   * Retrieves data room type data and its associated hotel code from the master database.
   */
  async getMasterRoom(roomTypeId: number): Promise<HotelRoomType | null> {
    // Note: Assuming relations are defined or we join to get hotel_code if needed
    return await this.roomRepo.findOne({ where: { id: roomTypeId } });
  }

  /**
   * Retrieves data rate plan data from the master database.
   */
  async getMasterRatePlan(ratePlanId: number): Promise<HotelRatePlan | null> {
    return await this.rateRepo.findOne({ where: { id: ratePlanId } });
  }
}