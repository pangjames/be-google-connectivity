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
        const hotelId = body.hotelId || body.entityReference?.hotelId;
        let hotelCode = body.hotelCode || body.entityReference?.hotelCode;
        const promotionId = body.promotionId || body.entityReference?.promotionId;
        const action = body.action || body.entityReference?.action;

        if (!promotionId) {
          this.logger.warn(`[PROMOTION CONSUMER] Skipping message due to missing promotionId: ${msg.Body}`);
          continue;
        }

        // --- CASE A: GLOBAL BROADCAST (Upsert & Delete) ---
        if (!hotelId && !hotelCode) {
          this.logger.log(`[PROMOTION BROADCAST] Processing global ${action} for Promo ID: ${promotionId}`);

          // 1. Ambil semua hotel yang aktif
          const activeSetups = await this.setupRepo.find({
            where: { setup_status: 1 },
            select: { hotel_code: true, hotel_id: true },
          });

          // 2. Hilangkan duplikasi hotel (karena 1 hotel bisa punya banyak setup room/rate)
          const uniqueHotels = new Map<string, number>();
          activeSetups.forEach((setup) => uniqueHotels.set(setup.hotel_code, setup.hotel_id));

          let promoEntity = null;
          const blacklistHotelIds = new Set<number>();

          // 3. Jika Upsert, ambil data promo untuk mengecek daftar exclude (blacklist)
          if (action === 'upsert') {
            // Null dikirim sebagai hotelId karena kita menarik master data promo-nya saja
            promoEntity = await this.promoRepo.getPromotionData(null, promotionId, action);
            
            if (!promoEntity) {
              this.logger.warn(`[PROMOTION CONSUMER] Skipping global broadcast, promoEntity not found: ${promotionId}`);
              continue;
            }
            
            // 4. Kumpulkan ID hotel yang di-exclude (berada di tabel applies saat role = 0)
            if (promoEntity.role === 0 && promoEntity.applies) {
              promoEntity.applies.forEach((app) => {
                if (app.hotel_id) blacklistHotelIds.add(Number(app.hotel_id));
              });
            }
          }

          // 5. Looping dan kirim XML ke masing-masing hotel secara massal
          for (const [targetCode, targetId] of uniqueHotels.entries()) {
            let xmlPayload = null;

            if (action === 'delete') {
              xmlPayload = this.promoMaterializer.materialize(targetCode, { id: promotionId } as any, 'delete');
            } else if (action === 'upsert' && promoEntity) {
              // Validasi Blacklist: Jika hotel masuk dalam daftar pengecualian, cabut/jangan beri promo!
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
          continue; // Lanjut ke antrean pesan SQS berikutnya
        }

        // --- CASE B: SPECIFIC HOTEL (Upsert / Delete 1 Hotel) ---
        // If hotelCode is missing but hotelId is present (and numeric), lookup hotelCode from setup DB
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