import { Injectable, Logger } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromotionRepositoryService } from '../services/promotion-repository.service';
import { PromotionMaterializerService } from '../services/promotion-materializer.service';
import { GoogleApiService } from '../services/google-api.service';
import { HotelConnectivitySetup } from '../../common/entities/hotel-connectivity-setup.entity';

@Injectable()
export class PromotionSyncConsumer {
  private readonly logger = new Logger(PromotionSyncConsumer.name);

  constructor(
    private readonly promoRepo: PromotionRepositoryService,
    private readonly promoMaterializer: PromotionMaterializerService,
    private readonly googleApiService: GoogleApiService,
    @InjectRepository(HotelConnectivitySetup)
    private readonly setupRepo: Repository<HotelConnectivitySetup>,
  ) {}

  async handleBatchMessages(messages: Message[]): Promise<void> {
    for (const msg of messages) {
      try {
        const body = typeof msg.Body === 'string' ? JSON.parse(msg.Body) : msg.Body;
        
        const hotelId = body.hotelId || body.entityReference?.hotelId;
        let hotelCode = body.hotelCode || body.entityReference?.hotelCode;
        const promotionId = body.promotionId || body.entityReference?.promotionId;
        const action = body.action || body.entityReference?.action;

        if (!promotionId) {
          this.logger.warn(`[PROMOTION CONSUMER] Skipping message due to missing promotionId: ${msg.Body}`);
          continue;
        }

        // --- KASUS A: GLOBAL BROADCAST DELETE (Tanpa hotelId/hotelCode) ---
        if (action === 'delete' && !hotelId && !hotelCode) {
          this.logger.log(`[PROMOTION BROADCAST DELETE] Processing global delete for Promo ID: ${promotionId}`);

          const activeSetups = await this.setupRepo.createQueryBuilder('s')
            .select('DISTINCT s.hotel_code', 'hotel_code')
            .where('s.setup_status = 1')
            .getRawMany();

          for (const item of activeSetups) {
            const targetCode = item.hotel_code;
            const xmlPayload = this.promoMaterializer.materialize(targetCode, { id: promotionId } as any, 'delete');
            await this.googleApiService.pushPayload(targetCode, xmlPayload, 'Promotions');
          }
          continue;
        }

        // --- KASUS B: SPECIFIC HOTEL (Upsert / Delete 1 Hotel) ---
        // Jika hotelCode belum ada tapi hotelId ada (dan numerik), cari hotelCode dari DB setup
        if (!hotelCode && hotelId && !isNaN(Number(hotelId))) {
          const setup = await this.setupRepo.findOne({
            where: { hotel_id: Number(hotelId) },
            select: { hotel_code: true },
          });
          if (setup) {
            hotelCode = setup.hotel_code;
          }
        }

        const targetIdentifier = hotelCode || (hotelId ? String(hotelId) : null);
        if (!targetIdentifier) {
          this.logger.warn(`[PROMOTION CONSUMER] Skipping message due to missing hotel target: ${msg.Body}`);
          continue;
        }

        this.logger.log(`[PROMOTION CONSUMER] Processing PromoID: ${promotionId} for Hotel: ${targetIdentifier}`);

        const promoEntity = await this.promoRepo.getPromotionData(hotelId, promotionId, action);
        if (!promoEntity) {
          this.logger.warn(`[PROMOTION CONSUMER] Skipping message due to missing promoEntity: ${promotionId}`);
          continue;
        }

        const xmlPayload = this.promoMaterializer.materialize(targetIdentifier, promoEntity, action);

        if (!xmlPayload) {
          this.logger.warn(`[PROMOTION CONSUMER] Promotion XML payload empty for Promo ID ${promotionId}`);
          continue;
        }

        await this.googleApiService.pushPayload(targetIdentifier, xmlPayload, 'Promotions');

      } catch (error: any) {
        this.logger.error(`[PROMOTION CONSUMER ERROR] Failed to process promotion SQS message`, error.stack);
        throw error;
      }
    }
  }
}
