import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class GoogleApiService {
  private readonly logger = new Logger(GoogleApiService.name);
  private readonly apiUrl: string;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('GOOGLE_HOTEL_ARI_URL') || 'https://www.google.com';
  }

  private getEndpointPath(messageType: string): string {
    if (messageType.includes('Rate')) return '/travel/hotels/uploads/ota/hotel_rate_amount_notif';
    if (messageType.includes('Avail')) return '/travel/hotels/uploads/ota/hotel_avail_notif';
    if (messageType.includes('Inv')) return '/travel/hotels/uploads/ota/hotel_inv_count_notif';
    if (messageType.includes('Promotions')) return '/travel/hotels/uploads/promotions';
    if (messageType.includes('Property')) return '/travel/hotels/uploads/property_data';
    
    return '/travel/hotels/uploads/ari';
  }

  async pushPayload(hotelCode: string, xmlPayload: string, messageType: string): Promise<boolean> {
    const cleanBaseUrl = this.apiUrl.replace(/\/$/, '');
    const endpointPath = this.getEndpointPath(messageType);
    const url = `${cleanBaseUrl}${endpointPath}`; // Hasil: http://192.168.0.21:3000/mock-google-api/travel/hotels/uploads/...
    
    this.logger.log(`Pushing ${messageType} for ${hotelCode} to: ${url}`);
    
    try {
      const response = await axios.post(url, xmlPayload, {
        headers: { 'Content-Type': 'application/xml' },
        timeout: 10000,
        responseType: 'text',
      });

      if (response.data && response.data.includes('<Success/>')) {
        this.logger.log(`Success pushed ${messageType} for ${hotelCode}`);
        return true;
      } else {
        throw new Error(`Google API error: ${response.data}`);
      }
    } catch (error: any) {
      if (error.response?.status === 429 || (error.response?.data && error.response.data.includes('6032'))) {
         this.logger.error(`[RATE LIMIT 6032] Limit exceeded for ${hotelCode}.`);
      } else {
         this.logger.error(`Failed to push ${messageType} for ${hotelCode}: ${error.message}`);
      }
      throw error;
    }
  }
}
