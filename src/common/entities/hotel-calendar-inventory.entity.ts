import { Entity, Column } from 'typeorm';

@Entity('tb_hotel_calendar_inventory')
export class HotelCalendarInventory {
  @Column()
  hotel_id: number;

  @Column({ primary: true })
  hotel_code: string;

  @Column({ primary: true })
  room_type_id: number;

  @Column({ primary: true })
  rate_plan_id: number;

  @Column({ primary: true, type: 'date' })
  date: Date;

  @Column('decimal', { precision: 10, scale: 2 })
  total_amount_after_tax: number;

  @Column()
  inv_count: number;

  @Column('tinyint', { default: 1 })
  restriction_master: number;

  @Column('tinyint', { default: 1 })
  restriction_arrival: number;

  @Column('tinyint', { default: 1 })
  restriction_departure: number;

  @Column()
  set_min_los: number;
}
