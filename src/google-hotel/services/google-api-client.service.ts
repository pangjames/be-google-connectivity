import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class GoogleApiClientService {
  private readonly logger = new Logger(GoogleApiClientService.name);
  private readonly apiUrl: string;
  private readonly authToken: string;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('GOOGLE_HOTEL_ARI_URL') || '';
    this.authToken = this.configService.get<string>('GOOGLE_HOTEL_AUTH_TOKEN') || '';
  }

  async pushPayload(hotelCode: string, xmlPayload: string, messageType: string): Promise<boolean> {
    const url = this.apiUrl ? this.apiUrl.replace('{hotelId}', hotelCode) : `https://www.google.com/travel/hotels/uploads/ari`;
    
    this.logger.log(`Pushing ${messageType} for ${hotelCode} to Google ARI`);
    
    try {
      const response = await axios.post(url, xmlPayload, {
        headers: {
          'Content-Type': 'application/xml',
          'Authorization': `Bearer ${this.authToken}`,
        },
        timeout: 10000, // 10 seconds timeout
        responseType: 'text',
      });

      // Google returns an XML response that should contain <Success/>
      if (response.data && response.data.includes('<Success/>')) {
        this.logger.log(`Successfully pushed ${messageType} for ${hotelCode}`);
        return true;
      } else {
        const errorMsg = `Google API warning/error for ${hotelCode}: ${response.data}`;
        this.logger.warn(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      this.logger.error(`Failed to push ${messageType} for ${hotelCode}`, error.message);
      // Depending on the error, we might want to throw to let BullMQ retry
      throw error;
    }
  }
}
