import { Injectable } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource } from 'typeorm';
import { HotelCalendarInventory } from '../../common/entities/hotel-calendar-inventory.entity';
import { HotelRoomType } from '../../common/entities/hotel-room-type.entity';
import { HotelRatePlan } from '../../common/entities/hotel-rate-plan.entity';

@Injectable()
export class CalendarRepositoryService {
  constructor(
    @InjectRepository(HotelCalendarInventory, 'googleConnection') // <-- DB Google
    private readonly calendarRepo: Repository<HotelCalendarInventory>,
    @InjectRepository(HotelRoomType) // <-- DB Core (Default)
    private readonly roomTypeRepo: Repository<HotelRoomType>,
    @InjectRepository(HotelRatePlan) // <-- DB Core (Default)
    private readonly ratePlanRepo: Repository<HotelRatePlan>,
    @InjectDataSource() private readonly coreDataSource: DataSource,
  ) {}

  async getInventoriesForDateRange(
    hotelCode: string,
    startDate: string,
    endDate: string,
    queryRunner?: QueryRunner,
    roomTypeId?: number,
    ratePlanId?: number
  ): Promise<any[]> {
    const qb = queryRunner
      ? queryRunner.manager.createQueryBuilder(HotelCalendarInventory, 'c')
      : this.calendarRepo.createQueryBuilder('c');

    qb.where('c.hotel_code = :hotelCode', { hotelCode })
      .andWhere('c.date BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (roomTypeId) qb.andWhere('c.room_type_id = :roomTypeId', { roomTypeId });
    if (ratePlanId) qb.andWhere('c.rate_plan_id = :ratePlanId', { ratePlanId });

    const rawInventories = await qb
      .orderBy('c.date', 'ASC')
      .addOrderBy('c.room_type_id', 'ASC')
      .addOrderBy('c.rate_plan_id', 'ASC')
      .getMany();

    if (rawInventories.length === 0) return [];

    // Mengambil data capacity (guest) dari Database Core secara runtime
    const masterRooms = await this.roomTypeRepo.find({
      where: { hotel_code: hotelCode },
      select: { id: true, guest: true },
    });
    const capacityMap = new Map(masterRooms.map(room => [room.id, room.guest]));

    return rawInventories.map(inv => {
      return {
        ...inv,
        capacity: capacityMap.get(inv.room_type_id) || 2, // Fallback default 2
      };
    });
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
    
    const ratePlans = await this.ratePlanRepo.createQueryBuilder('rp')
      .innerJoin('tb_hotel_room_type', 'rt', 'rt.id = rp.room_type_id')
      .where('rt.hotel_code = :hotelCode', { hotelCode })
      .getMany();

    return { roomTypes, ratePlans };
  }
}
