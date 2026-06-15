import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tb_hotel')
export class Hotel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  property_category: number;

  @Column({ nullable: true })
  property_brand: number;

  @Column()
  role: number;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ default: 0 })
  status: number;

  @Column('decimal', { precision: 4, scale: 2, nullable: true, default: 0.0 })
  be_comission: number;

  @Column()
  be_pay_at_hotel: number;

  @Column()
  region: string;

  @Column()
  area: string;

  @Column('text')
  street_address: string;

  @Column({ nullable: true })
  zip_code: string;

  @Column({ nullable: true })
  hotel_star: number;

  @Column({ nullable: true })
  phone: string;

  @Column('bigint', { nullable: true })
  wa_number: number;

  @Column({ nullable: true })
  email_hotel: string;

  @Column()
  email_quota_month: number;

  @Column()
  email_send_month: number;

  @Column()
  precheckin_send_mail: number;

  @Column()
  checkin_send_mail: number;

  @Column()
  checkout_send_mail: number;

  @Column({ nullable: true })
  on_booking_send_email: number;

  @Column({ nullable: true })
  on_payment_send_email: number;

  @Column({ nullable: true })
  web_link: string;

  @Column({ nullable: true })
  fb_link: string;

  @Column({ nullable: true })
  ig_link: string;

  @Column({ nullable: true })
  tiktok_link: string;

  @Column({ nullable: true })
  yt_link: string;

  @Column({ nullable: true })
  twitter_link: string;

  @Column({ nullable: true })
  map_link: string;

  @Column({ nullable: true })
  title: string;

  @Column('text', { nullable: true })
  description: string;

  @Column()
  crm: number;

  @Column()
  loyalty: number;

  @Column()
  be: number;

  @Column()
  create_user: string;

  @Column()
  create_date: Date;

  @Column()
  update_user: string;

  @Column()
  update_date: Date;

  @Column({ nullable: true })
  latitude: string;

  @Column({ nullable: true })
  longitude: string;
}
