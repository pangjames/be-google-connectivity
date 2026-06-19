import { Controller, Post, Body, Logger } from '@nestjs/common';
import { EventHandlerService } from '../services/event-handler.service';

@Controller('pms/webhook')
export class PmsWebhookController {
  private readonly logger = new Logger(PmsWebhookController.name);

  constructor(private readonly eventHandlerService: EventHandlerService) {}

  @Post('event')
  async handleEvent(@Body() payload: any) {
    this.logger.log(`Received PMS Event: ${payload.type}`);

    try {
      if (payload.type === 'RATE_CHANGE') {
        await this.eventHandlerService.handleRateChange(
          payload.hotel,
          payload.room,
          payload.rate,
          payload.start,
          payload.end,
          payload.newRate,
        );
      } else if (payload.type === 'RESTRICTION_CHANGE') {
        await this.eventHandlerService.handleRestrictionChange(
          payload.hotel,
          payload.room,
          payload.rate,
          payload.start,
          payload.end,
          payload.isOpen,
        );
      }

      return { status: 'success', message: 'Event processed incrementally' };
    } catch (error) {
      this.logger.error('Failed to process PMS event', error.stack);
      return { status: 'error', message: 'Failed to process event' };
    }
  }
}
