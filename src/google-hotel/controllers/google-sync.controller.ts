import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GoogleSyncService } from '../services/google-sync.service';
import { ManualSyncRequestDto, DeltaSyncRequestDto } from './dtos/sync-request.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

@ApiTags('Admin / Google Hotel Sync')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
@Controller('admin/google-hotel')
export class GoogleSyncController {
  private readonly logger = new Logger(GoogleSyncController.name);

  constructor(
    private readonly googleSyncService: GoogleSyncService,
  ) {}

  @Post('manual-sync')
  @ApiOperation({ summary: 'Force a full cascade sync over a date range' })
  async manualSync(
    @Body() dto: ManualSyncRequestDto,
  ) {
    this.logger.log(`Manual sync requested for ${dto.hotelCode}`);
    return this.googleSyncService.syncDateRange({
      hotelCode: dto.hotelCode,
      startDate: dto.startDate,
      endDate: dto.endDate,
      priority: 1, // High priority for manual sync
    });
  }

  @Post('delta-sync')
  @ApiOperation({ summary: 'Trigger sync for a specific isolated date' })
  async deltaSync(
    @Body() dto: DeltaSyncRequestDto,
  ) {
    this.logger.log(`Delta sync requested for ${dto.hotelCode} on ${dto.date}`);
    return this.googleSyncService.syncDateRange({
      hotelCode: dto.hotelCode,
      startDate: dto.date,
      endDate: dto.date,
      priority: 1, // High priority for delta sync
    });
  }
}
