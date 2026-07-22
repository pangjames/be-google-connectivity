import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { HotelPromotion } from './hotel-promotion.entity';

@Entity('tb_hotel_promotion_blackout')
export class HotelPromotionBlackout {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  promotion_id: number;

  @Column({ type: 'int' })
  type: number; // 0=Booking, 1=Stay

  @Column({ type: 'date' })
  date_blackout: string;

  @ManyToOne(() => HotelPromotion, (promo) => promo.blackouts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promotion_id' })
  promotion: HotelPromotion;
}