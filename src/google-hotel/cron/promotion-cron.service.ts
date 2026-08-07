import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HotelPromotion } from '../../common/entities/hotel-promotion.entity';
import { GoogleDispatcherService } from '../services/google-dispatcher.service';

@Injectable()
export class PromotionCronService {
  private readonly logger = new Logger(PromotionCronService.name);

  constructor(
    @InjectRepository(HotelPromotion)
    private readonly promotionRepo: Repository<HotelPromotion>,
    private readonly googleDispatcherService: GoogleDispatcherService,
  ) {}

  @Cron('0 1 * * *')
  async handlePromotionSanityCheck() {
    this.logger.log('Starting daily Promotion Sanity Check & Self-Healing Cron...');

    const todayStr = new Date().toISOString().split('T')[0];

    try {
      const promotionsToUpdate = await this.promotionRepo.createQueryBuilder('p')
        .leftJoinAndSelect('p.blackouts', 'b', 'b.type = 0 AND b.date_blackout = :today', { today: todayStr })
        .where('p.promo_status = 1 AND p.promo_type = 1')
        .andWhere(
          '(p.end_date < :today OR b.id IS NOT NULL)',
          { today: todayStr },
        )
        .getMany();

      if (promotionsToUpdate.length === 0) {
        this.logger.log('No promotions require deletion or blackout sync for today.');
        return;
      }

      this.logger.log(`Found ${promotionsToUpdate.length} promotion(s) requiring delete action for today.`);

      for (const promo of promotionsToUpdate) {
        try {
          // Kirim perintah promo delete ke SQS melalui dispatcher
          await this.googleDispatcherService.dispatchPromotionCommand(
            promo.id,
            'PROMOTION_DELETE'
          );

          this.logger.log(`Successfully queued delete action for Promo ID: ${promo.id}`);
        } catch (error: any) {
          this.logger.error(`Failed to queue delete action for Promo ID: ${promo.id}`, error.stack);
        }
      }
      this.logger.log('Completed daily promotion sanity check queueing.');

    } catch (error: any) {
      this.logger.error('Failed to execute daily Promotion Sanity Check Cron', error.stack);
    }
  }
}
