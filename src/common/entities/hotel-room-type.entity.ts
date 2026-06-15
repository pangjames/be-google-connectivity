import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tb_hotel_room_type')
export class HotelRoomType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hotel_id: number;

  @Column()
  hotel_code: string;

  @Column()
  name: string;

  @Column('text')
  description: string;

  @Column()
  room_qty: number;

  @Column()
  room_available: number;

  @Column()
  cut_off_day: number;

  @Column('float')
  min_rate: number;

  @Column()
  view: string;

  @Column('float')
  room_size: number;

  @Column()
  smoking: number;

  @Column()
  bathroom: number;

  @Column()
  guest: number;

  @Column()
  extra_guest: number;

  @Column({ nullable: true })
  bed_type: string;

  @Column({ nullable: true })
  bed_qty: number;

  @Column()
  status: number;

  @Column()
  create_user: string;

  @Column()
  create_date: Date;

  @Column()
  update_user: string;

  @Column()
  update_date: Date;
}
