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
    @InjectRepository(HotelConnectivitySetup, 'googleConnection') // <-- Diarahkan ke DB Google
    private readonly setupRepo: Repository<HotelConnectivitySetup>,
  ) {}

  async handleBatchMessages(messages: Message[]): Promise<void> {
    for (const msg of messages) {
      let body;
      try {
        body = typeof msg.Body === 'string' ? JSON.parse(msg.Body) : msg.Body;
      } catch (err) {
        this.logger.warn(`[PROMOTION CONSUMER SKIPPED] Invalid JSON Body.`);
        continue;
      }

      if (!body) {
        this.logger.warn(`[PROMOTION CONSUMER SKIPPED] Empty Body.`);
        continue;
      }

      try {
        const promotionId = body.promotionId || body.entityReference?.promotionId;
        const updateType = body.updateType || body.entityReference?.updateType;

        if (!promotionId) {
          this.logger.warn(`[PROMOTION CONSUMER] Skipping message due to missing promotionId: ${msg.Body}`);
          continue;
        }

        const action = updateType === 'PROMOTION_DELETE' ? 'delete' : 'upsert';
        this.logger.log(`[PROMOTION EVENT] Processing Promo ID: ${promotionId}, event: ${updateType} (derived action: ${action})`);

        // Fetch master data of the promotion from NestJS database first
        const promoEntity = await this.promoRepo.getPromotionData(null, promotionId, action);
        if (!promoEntity) {
          this.logger.warn(`[PROMOTION CONSUMER] Skipping event, promoEntity not found in DB: ${promotionId}`);
          continue;
        }

        // Determine target hotels based on promotion role (Global vs Specific)
        const isGlobal = promoEntity.role === undefined || Number(promoEntity.role) === 0;

        if (isGlobal) {
          // --- ROLE 0: GLOBAL BROADCAST ---
          this.logger.log(`[PROMOTION BROADCAST] Distributing global promotion ID: ${promotionId} (action: ${action})`);

          // 1. Get all active hotels from setup database
          const activeSetups = await this.setupRepo.find({
            where: { setup_status: 1 },
            select: { hotel_code: true, hotel_id: true },
          });

          // 2. Remove duplicates
          const uniqueHotels = new Map<string, number>();
          activeSetups.forEach((setup) => uniqueHotels.set(setup.hotel_code, setup.hotel_id));

          // 3. Collect blacklisted hotel IDs (from applies table when role = 0)
          const blacklistHotelIds = new Set<number>();
          if (action === 'upsert' && promoEntity.applies) {
            promoEntity.applies.forEach((app) => {
              if (app.hotel_id) blacklistHotelIds.add(Number(app.hotel_id));
            });
          }

          // 4. Send XML payloads to all target hotels
          for (const [targetCode, targetId] of uniqueHotels.entries()) {
            let xmlPayload = null;

            if (action === 'delete') {
              xmlPayload = this.promoMaterializer.materialize(targetCode, promoEntity, 'delete');
            } else if (action === 'upsert') {
              if (blacklistHotelIds.has(targetId)) {
                this.logger.log(`[PROMOTION EXCLUDE] Hotel ${targetCode} is blacklisted. Sending DELETE XML.`);
                xmlPayload = this.promoMaterializer.materialize(targetCode, promoEntity, 'delete');
              } else {
                xmlPayload = this.promoMaterializer.materialize(targetCode, promoEntity, 'upsert');
              }
            }

            if (xmlPayload) {
              await this.googleApiService.pushPayload(targetCode, xmlPayload, 'Promotions');
            }
          }
        } else {
          // --- ROLE 1: SPECIFIC HOTEL (Can apply to one or multiple hotels) ---
          
          // 1. Extract all hotel_ids from the applies relation
          const targetHotelIds = promoEntity.applies && promoEntity.applies.length > 0 
            ? promoEntity.applies.map(app => app.hotel_id).filter(Boolean)
            : [];

          if (targetHotelIds.length === 0) {
            this.logger.warn(`[PROMOTION CONSUMER] Specific promotion ID: ${promotionId} is missing hotel_id(s) in applies relation. Skipping event.`);
            continue;
          }

          // 2. Retrieve hotel codes for all targeted hotel IDs from the Google setup repository
          const setups = await this.setupRepo.find({
            where: targetHotelIds.map(id => ({ hotel_id: id })),
            select: { hotel_code: true, hotel_id: true },
          });

          if (setups.length === 0) {
            this.logger.warn(`[PROMOTION CONSUMER] Setup records not found for specific promotion ID: ${promotionId}. Skipping event.`);
            continue;
          }

          // 3. Loop through each target hotel to materialize and push the promotion XML payload
          for (const setup of setups) {
            const targetCode = setup.hotel_code;
            this.logger.log(`[PROMOTION SPECIFIC] Distributing specific promotion ID: ${promotionId} to Hotel: ${targetCode} (action: ${action})`);

            const xmlPayload = this.promoMaterializer.materialize(targetCode, promoEntity, action);
            if (xmlPayload) {
              await this.googleApiService.pushPayload(targetCode, xmlPayload, 'Promotions');
            }
          }
        }

      } catch (error: any) {
        this.logger.error(`[PROMOTION CONSUMER ERROR] Failed to process promotion SQS message`, error.stack);
        throw error;
      }
    }
  }
}