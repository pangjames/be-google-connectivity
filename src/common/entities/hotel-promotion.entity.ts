import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { HotelPromotionBlackout } from './hotel-promotion-blackout.entity';
import { HotelPromotionApply } from './hotel-promotion-apply.entity';

@Entity('tb_hotel_promotion')
export class HotelPromotion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  role: number; // 0=All hotel, 1=spesific hotel

  @Column({ type: 'int', nullable: true })
  hotel_id: number;

  @Column({ type: 'int' })
  promo_type: number; // 0=coupon, 1=customize deals

  @Column({ type: 'int', default: 1 })
  promo_status: number; // 0=Non-Active, 1=Active

  @Column({ type: 'int' })
  type: number; // 0=percentage, 1=fix amount

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'decimal', precision: 13, scale: 2 })
  discount_value: number;

  @Column({ type: 'decimal', precision: 13, scale: 2, default: 0.00 })
  trx_min: number;

  @Column({ type: 'int' })
  target: number; // 0 = Publik / All

  @Column({ type: 'date', nullable: true })
  start_date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string;

  @Column({ type: 'varchar', nullable: true })
  booking_days: string | null;

  @Column({ type: 'date', nullable: true })
  stay_start_date: string;

  @Column({ type: 'date', nullable: true })
  stay_end_date: string;

  @Column({ type: 'varchar', nullable: true })
  stay_days: string | null;

  @OneToMany(() => HotelPromotionBlackout, (blackout) => blackout.promotion)
  blackouts: HotelPromotionBlackout[];

  @OneToMany(() => HotelPromotionApply, (apply) => apply.promotion)
  applies: HotelPromotionApply[];
}