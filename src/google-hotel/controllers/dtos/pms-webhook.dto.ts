import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsBoolean, IsDateString, IsIn } from 'class-validator';

export class AriChangePayloadDto {
  @ApiProperty({ example: 'ARI_CHANGE', description: 'Event type tracking price/status changes' })
  @IsIn(['ARI_CHANGE'])
  type: 'ARI_CHANGE';

  @ApiProperty({ example: 'H001', description: 'Hotel code reference' })
  @IsString()
  hotel: string;

  @ApiProperty({ example: 1, description: 'Room type ID' })
  @IsNumber()
  room: number;

  @ApiProperty({ example: 1, description: 'Rate plan ID' })
  @IsNumber()
  rate: number;

  @ApiProperty({ example: '2026-07-03', description: 'Start date of change window (YYYY-MM-DD)' })
  @IsDateString()
  start: string;

  @ApiProperty({ example: '2026-07-10', description: 'End date of change window (YYYY-MM-DD)' })
  @IsDateString()
  end: string;
}
