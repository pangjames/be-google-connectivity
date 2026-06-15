import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tb_hotel_rate_plan')
export class HotelRatePlan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hotel_id: number;

  @Column()
  room_type_id: number;

  @Column()
  name: string;

  @Column('text', { nullable: true })
  description: string;

  @Column('float')
  rate: number;

  @Column('float')
  min_rate: number;

  @Column()
  min_night: number;

  @Column('float', { nullable: true })
  extra_adult_charge: number;

  @Column()
  food: number;

  @Column({ nullable: true })
  food_pack: number;

  @Column()
  food_desc: string;

  @Column()
  cancelation_policy: number;

  @Column()
  deposit_policy: number;

  @Column()
  status: number;

  @Column()
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
