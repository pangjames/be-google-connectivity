import { Entity, Column } from 'typeorm';

@Entity('tb_hotel_calendar_inventory')
export class HotelCalendarInventory {
  @Column({ primary: true })
  hotel_code: string;

  @Column({ primary: true })
  room_type_id: number;

  @Column({ primary: true })
  rate_plan_id: number;

  @Column({ primary: true, type: 'date' })
  date: Date;

  @Column()
  capacity: number;

  @Column('float')
  amount_after_tax: number;

  @Column()
  inv_count: number;

  @Column()
  restriction_master: string;

  @Column()
  restriction_arrival: string;

  @Column()
  restriction_departure: string;

  @Column()
  set_min_los: number;
}
