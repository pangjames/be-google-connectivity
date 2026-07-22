import { Controller, Post, Headers, Logger, Header, Param, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { type Request } from 'express'; 
import * as fs from 'fs';
import * as path from 'path';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

// Define the root directory path for storing compiled XML files
const STORAGE_DIR = path.join(process.cwd(), 'storage-xml');

// Generate the storage directory automatically if it does not exist
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}


@ApiTags('Mock Google API')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
@Controller('mock-google-api')
export class MockGoogleApiController {
  private readonly logger = new Logger(MockGoogleApiController.name);

  @ApiExcludeEndpoint()
  @Post('travel/hotels/:hotelId') 
  @Header('Content-Type', 'application/xml')
  @ApiOperation({ summary: 'Simulate Google XML receiver endpoint (Multi-Type OTA Standard)' })
  @ApiParam({ name: 'hotelId', example: 'CODE12345', required: true })
  async mockReceiver(
    @Param('hotelId') hotelId: string,
    @Req() req: Request, 
  ) {
    this.logger.log(`====== GOOGLE MOCK RECEIVER TRIGGERED ======`);
    
    // 1. Extract the raw text payload out of the incoming HTTP Request stream
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

    // 2. Identify incoming XML specs precisely using standard Google & OTA payload namespaces
    let messageType = 'generic';

    if (rawXml.includes('<HotelListFeed')) {
      messageType = 'hotellist'; // Master Profile Listing Feed
    } 
    else if (rawXml.includes('<Transaction') || rawXml.includes('<PropertyDataset')) {
      messageType = 'transaction'; // Room/Rate Meta-pricing Metadata
    }
    // Individual granular sorting for dynamic ARI message criteria
    else if (rawXml.includes('<OTA_HotelInvCountNotifRQ') || rawXml.includes('<Inventory>')) {
      messageType = 'ari-inventory'; // Room Allotment / Inventory Allocation Remaining
    } 
    else if (rawXml.includes('<OTA_HotelRateAmountNotifRQ') || rawXml.includes('<AvailRateUpdate')) {
      messageType = 'ari-rate'; // Room Pricing / Base Amount Matrix Updates
    } 
    else if (rawXml.includes('<OTA_HotelAvailNotifRQ')) {
      messageType = 'ari-availability'; // Room Sales Thresholds / Open-Close Restrictions (CTA/CTD)
    }
    else if (rawXml.includes('<Promotions')) {
      messageType = 'promotions'; 
    }
    
    // 3. Construct uniform file formatting metrics
    const fileName = `${hotelId}-${messageType}.xml`;
    const filePath = path.join(STORAGE_DIR, fileName);

    // 4. Validate payload context and stream into persistent server storage (Auto-Overwrites existing files)
    if (!rawXml || rawXml.trim() === '') {
      this.logger.error(`Received payload of type [${messageType.toUpperCase()}] for Hotel ID ${hotelId} is EMPTY!`);
    } else {
      fs.writeFileSync(filePath, rawXml, 'utf8');
      this.logger.log(`[File Saved] Successfully wrote payload [${messageType.toUpperCase()}] onto path: ${filePath}`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
    <NotificationResponse>
      <Success/>
    </NotificationResponse>`;
  }


  @Get('view-xml/:hotelId/:type')
  @Header('Content-Type', 'application/xml')
  @ApiOperation({ summary: 'Retrieve and display localized target XML schema contents directly' })
  @ApiParam({ name: 'hotelId', example: 'CODE12345' })
  @ApiParam({ name: 'type', description: 'Select payload classification: hotellist, transaction, ari-inventory, ari-rate, ari-availability', example: 'ari-rate' })
  @ApiResponse({ status: 200, description: 'Streams XML document matching parameter inputs back to client lookup' })
  async viewXmlByHotelAndType(
    @Param('hotelId') hotelId: string,
    @Param('type') type: string
  ) {
    const fileName = `${hotelId}-${type}.xml`;
    const filePath = path.join(STORAGE_DIR, fileName);
    
    // Check if the localized physical file path layout exists inside storage mapping bounds
    if (!fs.existsSync(filePath)) {
      return `<?xml version="1.0" encoding="UTF-8"?><Error>Target resource configuration file [${fileName}] was not found in active server storage profiles.</Error>`;
    }
    
    // Read the payload dataset structure from disk and drop back to client response
    const dataXml = fs.readFileSync(filePath, 'utf8');
    return dataXml;
  }
}
