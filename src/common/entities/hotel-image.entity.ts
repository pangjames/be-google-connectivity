import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tb_hotel_image')
export class HotelImage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hotel_id: number;

  @Column({ nullable: true })
  room_type_id: number;

  @Column()
  type: number;

  @Column({ default: 0 })
  main_image: number;

  @Column('text', { nullable: true })
  description: string;

  @Column({ nullable: true })
  filename: string;

  @Column({ nullable: true })
  sort_order: number;

  @Column()
  create_user: string;

  @Column()
  create_date: Date;

  @Column()
  update_user: string;

  @Column()
  update_date: Date;
}
