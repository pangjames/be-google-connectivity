import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { HotelPromotion } from './hotel-promotion.entity';

@Entity('tb_hotel_promotion_apply')
export class HotelPromotionApply {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  promotion_id: number;

  @Column({ type: 'int', nullable: true })
  hotel_id: number;

  @Column({ type: 'int', nullable: true })
  room_type_id: number | null; // null jika all room

  @Column({ type: 'int', nullable: true })
  rate_plan_id: number | null; // null jika all rate

  @ManyToOne(() => HotelPromotion, (promo) => promo.applies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promotion_id' })
  promotion: HotelPromotion;
}