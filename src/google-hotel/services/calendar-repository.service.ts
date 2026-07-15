import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
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
    queryRunner?: QueryRunner,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<any[]> { // returning any to include dynamically joined capacity
    const qb = queryRunner
      ? queryRunner.manager.createQueryBuilder(HotelCalendarInventory, 'c')
      : this.calendarRepo.createQueryBuilder('c');

    qb.leftJoin('tb_hotel_room_type', 'rt', 'c.room_type_id = rt.id')
      .select([
        'c.hotel_code as hotel_code',
        'c.room_type_id as room_type_id',
        'c.rate_plan_id as rate_plan_id',
        'c.date as date',
        'c.total_amount_after_tax as total_amount_after_tax',
        'c.inv_count as inv_count',
        'c.restriction_master as restriction_master',
        'c.restriction_arrival as restriction_arrival',
        'c.restriction_departure as restriction_departure',
        'c.set_min_los as set_min_los',
        'rt.guest as capacity'
      ])
      .where('c.hotel_code = :hotelCode', { hotelCode })
      .andWhere('c.date BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (roomTypeId) {
      qb.andWhere('c.room_type_id = :roomTypeId', { roomTypeId });
    }
    if (ratePlanId) {
      qb.andWhere('c.rate_plan_id = :ratePlanId', { ratePlanId });
    }

    return qb
      .orderBy('c.date', 'ASC')
      .addOrderBy('c.room_type_id', 'ASC')
      .addOrderBy('c.rate_plan_id', 'ASC')
      .getRawMany();
  }

  async purgeHistoricalData(): Promise<void> {
    await this.calendarRepo.createQueryBuilder()
      .delete()
      .from(HotelCalendarInventory)
      .where('date < CURRENT_DATE()')
      .execute();
  }

  async getMaxDate(hotelCode: string): Promise<Date | null> {
    const result = await this.calendarRepo.createQueryBuilder('c')
      .select('MAX(c.date)', 'maxDate')
      .where('c.hotel_code = :hotelCode', { hotelCode })
      .getRawOne();
      
    return result?.maxDate ? new Date(result.maxDate) : null;
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
