import { Entity, Column } from 'typeorm';

@Entity('tb_hotel_rate_custom')
export class HotelRateCustom {
  @Column({ primary: true, type: 'date' })
  date: Date;

  @Column({ primary: true })
  rate_plan_id: number;

  @Column({ nullable: true })
  room_qty: number;

  @Column('float', { nullable: true })
  rate: number;

  @Column({ default: 0, nullable: true })
  stop_sell: number;

  @Column({ default: 0, nullable: true })
  cta: number;

  @Column({ default: 0, nullable: true })
  ctd: number;

  @Column({ nullable: true })
  min_stay: number;

  @Column({ nullable: true })
  pay_at_hotel: number;

  @Column()
  create_user: string;

  @Column()
  create_date: Date;

  @Column()
  update_user: string;

  @Column()
  update_date: Date;
}
