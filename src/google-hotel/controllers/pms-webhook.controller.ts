import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { EventHandlerService } from '../services/event-handler.service';
import { RateChangeDto, RestrictionChangeDto } from './dtos/pms-webhook.dto';

@ApiTags('PMS Webhooks')
@Controller('pms/webhook')
export class PmsWebhookController {
  private readonly logger = new Logger(PmsWebhookController.name);

  constructor(private readonly eventHandlerService: EventHandlerService) {}

  @Post('rate-change')
  @ApiOperation({ summary: 'Receive a rate change event from PMS and push delta to Google' })
  @ApiBody({ type: RateChangeDto })
  async handleRateChange(@Body() payload: RateChangeDto) {
    this.logger.log(`Received RATE_CHANGE for hotel ${payload.hotel}`);
    try {
      await this.eventHandlerService.handleRateChange(
        payload.hotel,
        payload.room ?? 0,
        payload.rate ?? 0,
        payload.start,
        payload.end,
        payload.newRate ?? 0,
      );
      return { status: 'success', message: 'Rate change processed and queued to Google' };
    } catch (error) {
      this.logger.error('Failed to process RATE_CHANGE event', error.stack);
      return { status: 'error', message: 'Failed to process rate change' };
    }
  }

  @Post('restriction-change')
  @ApiOperation({ summary: 'Receive a restriction change event from PMS and push delta to Google' })
  @ApiBody({ type: RestrictionChangeDto })
  async handleRestrictionChange(@Body() payload: RestrictionChangeDto) {
    this.logger.log(`Received RESTRICTION_CHANGE for hotel ${payload.hotel}`);
    try {
      await this.eventHandlerService.handleRestrictionChange(
        payload.hotel,
        payload.room ?? 0,
        payload.rate ?? 0,
        payload.start,
        payload.end,
        payload.isOpen ?? false,
      );
      return { status: 'success', message: 'Restriction change processed and queued to Google' };
    } catch (error) {
      this.logger.error('Failed to process RESTRICTION_CHANGE event', error.stack);
      return { status: 'error', message: 'Failed to process restriction change' };
    }
  }
}
