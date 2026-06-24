import { Controller, Post, Body, Logger, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EventHandlerService } from '../services/event-handler.service';
import { RateChangeDto, RestrictionChangeDto } from './dtos/pms-webhook.dto';

@ApiTags('PMS Webhooks')
@Controller('pms/webhook')
export class PmsWebhookController {
  private readonly logger = new Logger(PmsWebhookController.name);

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

  @Post('rate-change')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Receive a rate change event from PMS and push delta to Google' })
  @ApiBody({ type: RateChangeDto })
  async handleRateChange(
    @Headers('Authorization') authHeader: string,
    @Body() payload: RateChangeDto,
  ) {
    this.validateToken(authHeader);
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Receive a restriction change event from PMS and push delta to Google' })
  @ApiBody({ type: RestrictionChangeDto })
  async handleRestrictionChange(
    @Headers('Authorization') authHeader: string,
    @Body() payload: RestrictionChangeDto,
  ) {
    this.validateToken(authHeader);
    this.logger.log(`Received RESTRICTION_CHANGE for hotel ${payload.hotel}`);
    try {
      await this.eventHandlerService.handleRestrictionChange(
        payload.hotel,
        payload.room ?? 0,
        payload.rate ?? 0,
        payload.start,
        payload.end,
        payload.isOpen ?? false,
        payload.restrictionType ?? 'master',
      );
      return { status: 'success', message: 'Restriction change processed and queued to Google' };
    } catch (error) {
      this.logger.error('Failed to process RESTRICTION_CHANGE event', error.stack);
      return { status: 'error', message: 'Failed to process restriction change' };
    }
  }
}
