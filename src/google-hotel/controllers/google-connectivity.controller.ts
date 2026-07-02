import { Controller, Post, Body, Logger, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EventHandlerService } from '../services/event-handler.service';
import { PropertyUpdateDto } from './dtos/google-connectivity.dto';

@ApiTags('Google Connectivity') // Membuat kelompok menu baru di Swagger
@Controller('google/connectivity')
export class GoogleConnectivityController {
  private readonly logger = new Logger(GoogleConnectivityController.name);

  constructor(
    private readonly eventHandlerService: EventHandlerService,
    private readonly configService: ConfigService,
  ) {}

  private validateToken(authHeader: string) {
    const validToken = this.configService.get<string>('ADMIN_API_TOKEN', 'default-secret-token');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== validToken) {
      throw new UnauthorizedException('Invalid or missing Bearer token');
    }
  }

  @Post('property-update')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync and validate property static data via Gatekeeper pipeline' })
  @ApiBody({ type: PropertyUpdateDto })
  async handlePropertyUpdate(
    @Headers('Authorization') authHeader: string,
    @Body() payload: PropertyUpdateDto,
  ) {
    this.validateToken(authHeader);
    // ✅ NEW CODE (Uses clean relation key)
    const logHotelId = payload.data?.[0]?.hotel_id ?? 'Unknown';
    this.logger.log(`Received PROPERTY_UPDATE [${payload.updateType.toUpperCase()}] via connectivity channel for Hotel ID ${logHotelId}`);
    
    try {
      await this.eventHandlerService.handleExtranetDeltaUpdate(
        payload.data,
        payload.updateType
      );
      
      return { status: 'success', message: 'Property static data received and evaluated by Gatekeeper' };
    } catch (error) {
      this.logger.error('Failed to process PROPERTY_UPDATE event', error.stack);
      return { status: 'error', message: 'Failed to process property static update' };
    }
  }
}