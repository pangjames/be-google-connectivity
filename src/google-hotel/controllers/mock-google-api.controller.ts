import { Controller, Post, Headers, Logger, Header, Param, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
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