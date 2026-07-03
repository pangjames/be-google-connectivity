import { Controller, Post, Body, Logger, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EventHandlerService } from '../services/event-handler.service';
import { AriChangePayloadDto } from './dtos/pms-webhook.dto';

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

  @Post('ari-change')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Receive price or status changes from PMS and push delta to Google via Thin Payload' })
  @ApiBody({ type: AriChangePayloadDto })
  async handleAriChange(
    @Headers('Authorization') authHeader: string,
    @Body() payload: AriChangePayloadDto,
  ) {
    this.validateToken(authHeader);
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