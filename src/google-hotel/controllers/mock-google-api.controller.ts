import { Controller, Post, Req, Res, HttpStatus, Logger, Get, Param, Header } from '@nestjs/common';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_DIR = path.join(process.cwd(), 'storage-xml');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

@Controller('mock-google-api/travel/hotels/uploads')
export class MockGoogleApiController {
  private readonly logger = new Logger(MockGoogleApiController.name);

  private extractHotelCode(xml: string): string {
    if (!xml) return 'unknown';
    const hotelCodeMatch = xml.match(/HotelCode=["']([^"']+)["']/i);
    if (hotelCodeMatch) return hotelCodeMatch[1];

    const hotelIdMatch = xml.match(/hotel_id=["']([^"']+)["']/i);
    if (hotelIdMatch) return hotelIdMatch[1];

    const propIdMatch = xml.match(/<Property\s+id=["']([^"']+)["']/i);
    if (propIdMatch) return propIdMatch[1];
    
    const propTextMatch = xml.match(/<Property>([^<]+)<\/Property>/i);
    if (propTextMatch) return propTextMatch[1].trim();

    return 'unknown';
  }

  private async saveXml(req: express.Request, messageType: string): Promise<string> {
    let rawXml = '';
    if (req.body && typeof req.body === 'string') {
      rawXml = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      rawXml = req.body.toString('utf8');
    } else {
      rawXml = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
    }

    const hotelCode = this.extractHotelCode(rawXml);
    let filenameSuffix = messageType;
    if (messageType === 'promotions') {
      const promoIdMatch = rawXml.match(/<Promotion\s+id=["']([^"']+)["']/i);
      const isDelete = rawXml.includes('action="delete"') || rawXml.includes("action='delete'");
      const promoId = promoIdMatch ? promoIdMatch[1] : 'unknown';
      const action = isDelete ? 'delete' : 'upsert';
      filenameSuffix = `promo-${promoId}-${action}`;
    }

    const fileName = `${hotelCode}-${filenameSuffix}.xml`;
    const filePath = path.join(STORAGE_DIR, fileName);

    if (rawXml && rawXml.trim() !== '') {
      fs.writeFileSync(filePath, rawXml, 'utf8');
      this.logger.log(`[File Saved] Successfully wrote payload [${messageType.toUpperCase()}] onto path: ${filePath}`);
    }
    return hotelCode;
  }

  @Post('ota/hotel_rate_amount_notif')
  async mockRate(@Req() req: express.Request, @Res() res: express.Response) {
    this.logger.log('[MOCK GOOGLE API] Received RATE Payload');
    await this.saveXml(req, 'ari-rate');
    return res.status(HttpStatus.OK).send('<?xml version="1.0" encoding="UTF-8"?><Success/>');
  }

  @Post('ota/hotel_avail_notif')
  async mockAvail(@Req() req: express.Request, @Res() res: express.Response) {
    this.logger.log('[MOCK GOOGLE API] Received AVAILABILITY Payload');
    await this.saveXml(req, 'ari-availability');
    return res.status(HttpStatus.OK).send('<?xml version="1.0" encoding="UTF-8"?><Success/>');
  }

  @Post('ota/hotel_inv_count_notif')
  async mockInv(@Req() req: express.Request, @Res() res: express.Response) {
    this.logger.log('[MOCK GOOGLE API] Received INVENTORY Payload');
    await this.saveXml(req, 'ari-inventory');
    return res.status(HttpStatus.OK).send('<?xml version="1.0" encoding="UTF-8"?><Success/>');
  }

  @Post('promotions')
  async mockPromotions(@Req() req: express.Request, @Res() res: express.Response) {
    this.logger.log('[MOCK GOOGLE API] Received PROMOTIONS Payload');
    await this.saveXml(req, 'promotions');
    return res.status(HttpStatus.OK).send('<?xml version="1.0" encoding="UTF-8"?><Success/>');
  }
  
  @Post('property_data')
  async mockProperty(@Req() req: express.Request, @Res() res: express.Response) {
    this.logger.log('[MOCK GOOGLE API] Received PROPERTY Payload');
    await this.saveXml(req, 'property_data');
    return res.status(HttpStatus.OK).send('<?xml version="1.0" encoding="UTF-8"?><Success/>');
  }

  @Get('view-xml/:hotelId/:type')
  @Header('Content-Type', 'application/xml')
  async viewXmlByHotelAndType(
    @Param('hotelId') hotelId: string,
    @Param('type') type: string
  ) {
    const fileName = `${hotelId}-${type}.xml`;
    const filePath = path.join(STORAGE_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return `<?xml version="1.0" encoding="UTF-8"?><Error>Target resource configuration file [${fileName}] was not found in active server storage profiles.</Error>`;
    }
    const dataXml = fs.readFileSync(filePath, 'utf8');
    return dataXml;
  }
}
