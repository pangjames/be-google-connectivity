import { Controller, Post, Body, Logger, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EventHandlerService } from '../services/event-handler.service';
import { PropertyUpdatePayloadDto } from './dtos/google-connectivity.dto'; // Sesuaikan import DTO

@ApiTags('Google Connectivity')
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
  @ApiOperation({ summary: 'Trigger property static sync via EntityReference (Read DB Change)' })
  @ApiBody({ type: PropertyUpdatePayloadDto })
  async handlePropertyUpdate(
    @Headers('Authorization') authHeader: string,
    @Body() payload: PropertyUpdatePayloadDto,
  ) {
    this.validateToken(authHeader);
    
    const { entityReference, updateType } = payload;
    this.logger.log(`Received PROPERTY_UPDATE [${updateType.toUpperCase()}] for Hotel ID ${entityReference.hotel_id}`);
    
    try {
      await this.eventHandlerService.handleExtranetDeltaUpdate(entityReference, updateType);
      
      return { 
        status: 'success', 
        message: 'Sync trigger received. Processing fresh data from Master DB.' 
      };
    } catch (error) {
      this.logger.error(`Failed to process PROPERTY_UPDATE event for Hotel ${entityReference.hotel_id}`, error.stack);
      return { status: 'error', message: 'Failed to trigger property update sync' };
    }
  }
}