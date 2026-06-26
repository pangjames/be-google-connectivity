import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('tb_hotel_connectivity_setup')
@Index('lookup_idx', ['hotel_code', 'room_type_id', 'rate_plan_id'])
@Index('status_active_idx', ['setup_status'])
export class HotelConnectivitySetup {
  @PrimaryColumn()
  hotel_id: number;

  @Column({ length: 100 })
  hotel_code: string;

  @Column({ length: 100 })
  hotel_name: string;

  @Column({ length: 255 })
  property_category: string;

  @Column({ length: 255, nullable: true })
  hotel_brand: string;

  @Column('text')
  street_address: string;

  @Column({ length: 100 })
  city: string;

  @Column({ length: 255 })
  province: string;

  @Column({ length: 255, nullable: true })
  zip_code: string;

  @Column({ length: 2, default: 'ID' })
  country: string;

  @Column({ length: 255 })
  latitude: string;

  @Column({ length: 255 })
  longitude: string;

  @Column({ length: 255 })
  phone: string;

  @PrimaryColumn()
  room_type_id: number;

  @Column({ length: 255 })
  room_type_name: string;

  @Column()
  room_capacity: number;

  @Column()
  room_smoking: number;

  @Column({ length: 255, nullable: true })
  room_view: string;

  @Column('text', { nullable: true })
  room_image_url: string;

  @PrimaryColumn()
  rate_plan_id: number;

  @Column({ length: 255 })
  rate_plan_name: string;

  @Column('tinyint')
  breakfast_included: number;

  @Column('tinyint')
  pay_at_hotel: number;

  @Column('tinyint', { default: 1 })
  setup_status: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
