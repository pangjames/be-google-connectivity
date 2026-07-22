import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { HotelPromotion } from '../../common/entities/hotel-promotion.entity';

@Injectable()
export class PromotionRepositoryService {
  constructor(
    @InjectRepository(HotelPromotion)
    private readonly repo: Repository<HotelPromotion>,
  ) {}

  async getPromotionData(
    hotelId: string | number | null | undefined, 
    promotionId: number,
    action?: string
  ): Promise<HotelPromotion | null> {
    
    // Jika HARD DELETE, jangan throw exception jika DB kosong!
    if (action === 'delete') {
      const promo = await this.repo.findOne({ where: { id: promotionId } });
      if (!promo) {
        // Return dummy entity minimal hanya agar ID terbaca
        const dummy = new HotelPromotion();
        dummy.id = promotionId;
        return dummy;
      }
      return promo;
    }

    let numericHotelId = hotelId;
    if (typeof hotelId === 'string' && isNaN(Number(hotelId))) {
      const hotel = await this.repo.manager.query(`SELECT id FROM tb_hotel WHERE code = ? LIMIT 1`, [hotelId]);
      if (hotel && hotel.length > 0) {
        numericHotelId = hotel[0].id;
      }
    }

    const qb = this.repo.createQueryBuilder('p')
      .leftJoinAndSelect('p.blackouts', 'b')
      .leftJoinAndSelect('p.applies', 'a')
      .where('p.id = :id', { id: promotionId })
      .andWhere('p.promo_status = 1 AND p.promo_type = 1 AND p.target = 0');

    if (numericHotelId) {
      qb.andWhere(
        new Brackets((qbInner) => {
          qbInner.where('p.role = 0').orWhere('p.role = 1 AND p.hotel_id = :hid', { hid: numericHotelId });
        }),
      );
    }

    const promo = await qb.getOne();

    if (!promo) {
      throw new NotFoundException(`Promotion ID ${promotionId} not found or invalid.`);
    }
    return promo;
  }
}