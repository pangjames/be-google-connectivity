import { ApiProperty } from '@nestjs/swagger';

export class PropertySyncReferenceDto {
  @ApiProperty({ example: 101, description: 'The unique identifier for the hotel (Always Required)' })
  hotel_id: number;

  @ApiProperty({ example: 12, required: false, description: 'Required if updateType is room or rate_plan' })
  room_type_id?: number;

  @ApiProperty({ example: 45, required: false, description: 'Required if updateType is rate_plan' })
  rate_plan_id?: number;
}

export class PropertyUpdatePayloadDto {
  @ApiProperty({ 
    enum: ['hotel', 'room', 'rate_plan'], 
    description: 'Defines the scope of the sync process to determine which master table to query' 
  })
  updateType: 'hotel' | 'room' | 'rate_plan';

  @ApiProperty({ type: PropertySyncReferenceDto })
  entityReference: PropertySyncReferenceDto;
}