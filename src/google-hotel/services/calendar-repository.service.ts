import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { HotelCalendarInventory } from '../../common/entities/hotel-calendar-inventory.entity';
import { HotelRoomType } from '../../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../../common/entities/hotel-rate-plan.entity';

@Injectable()
export class CalendarRepositoryService {
  constructor(
    @InjectRepository(HotelCalendarInventory)
    private readonly calendarRepo: Repository<HotelCalendarInventory>,
    @InjectRepository(HotelRoomType)
    private readonly roomTypeRepo: Repository<HotelRoomType>,
    @InjectRepository(HotelRatePlan)
    private readonly ratePlanRepo: Repository<HotelRatePlan>,
  ) {}

  async getInventoriesForDateRange(
    hotelCode: string,
    startDate: string,
    endDate: string,
  ): Promise<HotelCalendarInventory[]> {
    return this.calendarRepo.find({
      where: {
        hotel_code: hotelCode,
        date: Between(new Date(startDate), new Date(endDate)),
      },
      order: {
        date: 'ASC',
        room_type_id: 'ASC',
        rate_plan_id: 'ASC',
      },
    });
  }

  async getBaseData(hotelCode: string) {
    const roomTypes = await this.roomTypeRepo.find({
      where: { hotel_code: hotelCode },
    });
    
    // In a real app we might only want rate plans associated with these room types
    const ratePlans = await this.ratePlanRepo.createQueryBuilder('rp')
      .innerJoin('tb_hotel_room_type', 'rt', 'rt.id = rp.room_type_id')
      .where('rt.hotel_code = :hotelCode', { hotelCode })
      .getMany();

    return { roomTypes, ratePlans };
  }
}
