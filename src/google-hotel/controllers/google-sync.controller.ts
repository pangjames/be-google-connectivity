import { Controller, Post, Body, UseGuards, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GoogleSyncService } from '../services/google-sync.service';
import { ManualSyncRequestDto, DeltaSyncRequestDto } from './dtos/sync-request.dto';
import { ConfigService } from '@nestjs/config';

@ApiTags('Admin / Google Hotel Sync')
@Controller('admin/google-hotel')
export class GoogleSyncController {
  private readonly logger = new Logger(GoogleSyncController.name);

  constructor(
    private readonly googleSyncService: GoogleSyncService,
    private readonly configService: ConfigService,
  ) {}

  private validateToken(authHeader: string) {
    const validToken = this.configService.get<string>('ADMIN_API_TOKEN', 'default-secret-token');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== validToken) {
      throw new UnauthorizedException('Invalid or missing Bearer token');
    }
  }

  @Post('manual-sync')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force a full cascade sync over a date range' })
  async manualSync(
    @Headers('Authorization') authHeader: string,
    @Body() dto: ManualSyncRequestDto,
  ) {
    this.validateToken(authHeader);
    this.logger.log(`Manual sync requested for ${dto.hotelCode}`);
    return this.googleSyncService.syncDateRange({
      hotelCode: dto.hotelCode,
      startDate: dto.startDate,
      endDate: dto.endDate,
      priority: 1, // High priority for manual sync
    });
  }

  @Post('delta-sync')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger sync for a specific isolated date' })
  async deltaSync(
    @Headers('Authorization') authHeader: string,
    @Body() dto: DeltaSyncRequestDto,
  ) {
    this.validateToken(authHeader);
    this.logger.log(`Delta sync requested for ${dto.hotelCode} on ${dto.date}`);
    return this.googleSyncService.syncDateRange({
      hotelCode: dto.hotelCode,
      startDate: dto.date,
      endDate: dto.date,
      priority: 1, // High priority for delta sync
    });
  }
}
