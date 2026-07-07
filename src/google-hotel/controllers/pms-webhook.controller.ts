import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { EventHandlerService } from '../services/event-handler.service';
import { AriChangePayloadDto } from './dtos/pms-webhook.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

@ApiTags('PMS Webhooks')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
@Controller('pms/webhook')
export class PmsWebhookController {
  private readonly logger = new Logger(PmsWebhookController.name);

  constructor(
    private readonly eventHandlerService: EventHandlerService,
  ) {}

  @Post('ari-change')
  @ApiOperation({ summary: 'Receive price or status changes from PMS and push delta to Google via Thin Payload' })
  @ApiBody({ type: AriChangePayloadDto })
  async handleAriChange(
    @Body() payload: AriChangePayloadDto,
  ) {
    this.logger.log(`Received ARI_CHANGE trigger for hotel ${payload.hotel}`);
    
    try {
      await this.eventHandlerService.handleAriChange(
        payload.hotel,
        payload.room ?? 0,
        payload.rate ?? 0,
        payload.start,
        payload.end,
      );
      
      return { status: 'success', message: 'ARI change event captured. Master sync pipeline triggered.' };
    } catch (error) {
      this.logger.error(`Failed to process ARI_CHANGE event for hotel ${payload.hotel}`, error.stack);
      return { status: 'error', message: 'Failed to process ARI change trigger' };
    }
  }
}