import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ManualSyncRequestDto {
  @ApiProperty({ example: 'HTL123' })
  @IsString()
  @IsNotEmpty()
  hotelCode: string;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-07-31' })
  @IsDateString()
  endDate: string;
}

export class DeltaSyncRequestDto {
  @ApiProperty({ example: 'HTL123' })
  @IsString()
  @IsNotEmpty()
  hotelCode: string;

  @ApiProperty({ example: '2026-07-15' })
  @IsDateString()
  date: string;
}
