import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { EventHandlerService } from '../services/event-handler.service';
import { PropertyUpdatePayloadDto } from './dtos/google-connectivity.dto'; 
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

@ApiTags('Property')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
@Controller('google/connectivity')
export class GoogleConnectivityController {
  private readonly logger = new Logger(GoogleConnectivityController.name);

  constructor(
    private readonly eventHandlerService: EventHandlerService,
  ) {}

  @Post('property-update')
  @ApiOperation({ summary: 'Trigger property static sync via EntityReference (Read DB Change)' })
  @ApiBody({ type: PropertyUpdatePayloadDto })
  async handlePropertyUpdate(
    @Body() payload: PropertyUpdatePayloadDto,
  ) {    
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