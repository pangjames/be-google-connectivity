import { Controller, Post, Body } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { ApiTags, ApiOperation, ApiBody, ApiProperty } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

// --- DTO All Flow ---

class BootstrapDto {
  @ApiProperty({ example: { hotelId: 108 } })
  entityReference: { hotelId: number };
  @ApiProperty({ example: 'INITIAL_BOOTSTRAP' })
  updateType: string;
}

class HotelUpdateDto {
  @ApiProperty({ example: { hotelId: 108 } })
  entityReference: { hotelId: number };
  @ApiProperty({ example: 'HOTEL_UPDATE' })
  updateType: string;
}

class RoomUpdateDto {
  @ApiProperty({ example: { hotelId: 108, roomId: 10 } })
  entityReference: { hotelId: number; roomId: number };
  @ApiProperty({ example: 'ROOM_UPDATE' })
  updateType: string;
}

class RatePlanUpdateDto {
  @ApiProperty({ example: { hotelId: 108, roomId: 10, rateId: 22 } })
  entityReference: { hotelId: number; roomId: number; rateId: number };
  @ApiProperty({ example: 'RATE_PLAN_UPDATE' })
  updateType: string;
}

class AriChangeDto {
  @ApiProperty({ example: 'YK.143-V1Testing2' })
  hotelCode: string;
  @ApiProperty({ example: '2026-07-15' })
  startDate: string;
  @ApiProperty({ example: '2026-07-20' })
  endDate: string;
  @ApiProperty({ example: '10' })
  roomId: string;
  @ApiProperty({ example: '22' })
  rateId: string;
  @ApiProperty({ example: 'ARI_CHANGE' })
  updateType: string;
}

class DeltaSyncDto {
  @ApiProperty({ example: 'YK.143-V1Testing2' })
  hotelCode: string;
  @ApiProperty({ example: '2026-07-15' })
  date: string;
  @ApiProperty({ example: 'DELTA_SYNC' })
  updateType: string;
}

class ManualSyncDto {
  @ApiProperty({ example: 'YK.143-V1Testing2' })
  hotelCode: string;
  @ApiProperty({ example: '2026-08-01' })
  startDate: string;
  @ApiProperty({ example: '2026-08-31' })
  endDate: string;
  @ApiProperty({ example: 'MANUAL_SYNC' })
  updateType: string;
}

@ApiTags('AWS SQS Test Triggers')
@Controller('test-sqs')
export class TestSQSController {
  private readonly sqs: SQSClient;
  private readonly queueUrl: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID') || '';
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '';
    this.queueUrl = this.configService.get<string>('AWS_SQS_CONNECTIVITY_QUEUE_URL') || '';

    this.sqs = new SQSClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  private async dispatch(payload: any) {
    if (!this.queueUrl) {
      throw new Error("AWS_SQS_CONNECTIVITY_QUEUE_URL is not found in the configuration.");
    }

    const params = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(payload),
    };

    try {
      const result = await this.sqs.send(new SendMessageCommand(params));
      return {
        status: 'SUCCESS',
        updateType: payload.updateType,
        messageId: result.MessageId,
        info: `Successfully sent to SQS!`,
        payloadSent: payload,
      };
    } catch (err: any) {
      throw new Error(`Failed to send to SQS: ${err.message}`);
    }
  }

  @Post('bootstrap')
  @ApiOperation({ summary: 'Test SQS: INITIAL_BOOTSTRAP' })
  @ApiBody({ type: BootstrapDto })
  async testBootstrap(@Body() body: BootstrapDto) {
    return this.dispatch(body);
  }

  @Post('hotel-update')
  @ApiOperation({ summary: 'Test SQS: HOTEL_UPDATE' })
  @ApiBody({ type: HotelUpdateDto })
  async testHotelUpdate(@Body() body: HotelUpdateDto) {
    return this.dispatch(body);
  }

  @Post('room-update')
  @ApiOperation({ summary: 'Test SQS: ROOM_UPDATE' })
  @ApiBody({ type: RoomUpdateDto })
  async testRoomUpdate(@Body() body: RoomUpdateDto) {
    return this.dispatch(body);
  }

  @Post('rate-plan-update')
  @ApiOperation({ summary: 'Test SQS: RATE_PLAN_UPDATE' })
  @ApiBody({ type: RatePlanUpdateDto })
  async testRatePlanUpdate(@Body() body: RatePlanUpdateDto) {
    return this.dispatch(body);
  }

  @Post('ari-change')
  @ApiOperation({ summary: 'Test SQS: ARI_CHANGE' })
  @ApiBody({ type: AriChangeDto })
  async testAriChange(@Body() body: AriChangeDto) {
    return this.dispatch(body);
  }

  @Post('delta-sync')
  @ApiOperation({ summary: 'Test SQS: DELTA_SYNC' })
  @ApiBody({ type: DeltaSyncDto })
  async testDeltaSync(@Body() body: DeltaSyncDto) {
    return this.dispatch(body);
  }

  @Post('manual-sync')
  @ApiOperation({ summary: 'Test SQS: MANUAL_SYNC' })
  @ApiBody({ type: ManualSyncDto })
  async testManualSync(@Body() body: ManualSyncDto) {
    return this.dispatch(body);
  }
}