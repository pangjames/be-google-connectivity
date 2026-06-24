import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsBoolean, IsDateString, IsIn } from 'class-validator';

export class RateChangeDto {
  @ApiProperty({ example: 'RATE_CHANGE', description: 'Event type' })
  @IsIn(['RATE_CHANGE'])
  type: 'RATE_CHANGE';

  @ApiProperty({ example: 'H001', description: 'Hotel code' })
  @IsString()
  hotel: string;

  @ApiProperty({ example: 1, description: 'Room type ID' })
  @IsNumber()
  room: number;

  @ApiProperty({ example: 1, description: 'Rate plan ID' })
  @IsNumber()
  rate: number;

  @ApiProperty({ example: '2026-12-24', description: 'Start date (YYYY-MM-DD)' })
  @IsDateString()
  start: string;

  @ApiProperty({ example: '2026-12-31', description: 'End date (YYYY-MM-DD)' })
  @IsDateString()
  end: string;

  @ApiProperty({ example: 250000, description: 'New rate/price after tax' })
  @IsNumber()
  newRate: number;
}

export class RestrictionChangeDto {
  @ApiProperty({ example: 'RESTRICTION_CHANGE', description: 'Event type' })
  @IsIn(['RESTRICTION_CHANGE'])
  type: 'RESTRICTION_CHANGE';

  @ApiProperty({ example: 'H001', description: 'Hotel code' })
  @IsString()
  hotel: string;

  @ApiProperty({ example: 1, description: 'Room type ID' })
  @IsNumber()
  room: number;

  @ApiProperty({ example: 1, description: 'Rate plan ID' })
  @IsNumber()
  rate: number;

  @ApiProperty({ example: '2026-12-31', description: 'Start date (YYYY-MM-DD)' })
  @IsDateString()
  start: string;

  @ApiProperty({ example: '2026-12-31', description: 'End date (YYYY-MM-DD)' })
  @IsDateString()
  end: string;

  @ApiProperty({ example: false, description: 'true = Open, false = Closed (stop sell)' })
  @IsBoolean()
  isOpen: boolean;
}
