import { ApiProperty } from '@nestjs/swagger';

export class PropertyUpdateRowDto {
  // ==========================================
  // PRIMARY KEY CONNECTIONS
  // ==========================================
  @ApiProperty({ example: 101, description: 'ID Utama Hotel (Selalu Wajib)' })
  hotel_id: number;

  @ApiProperty({ example: 12, required: false, description: 'Wajib diisi jika updateType = room atau rate_plan' })
  room_type_id?: number;

  @ApiProperty({ example: 45, required: false, description: 'Wajib diisi jika updateType = rate_plan' })
  rate_plan_id?: number;

  // ==========================================
  // LEVEL 1: HOTEL GLOBAL PROFILE FIELDS
  // ==========================================
  @ApiProperty({ example: 'YK.143-V1Testing', required: false })
  hotel_code?: string;

  @ApiProperty({ example: 'Azana Hotel Yogyakarta', required: false })
  hotel_name?: string;

  @ApiProperty({ example: 'hotel', required: false, description: 'Dari ms_property_category' })
  property_category?: string;

  @ApiProperty({ example: 'Azana Style', required: false, description: 'Dari ms_brand' })
  hotel_brand?: string;

  @ApiProperty({ example: 'Jl. Jend. Sudirman No. 45', required: false })
  street_address?: string;

  @ApiProperty({ example: 'Yogyakarta', required: false, description: 'Mapping dari area' })
  city?: string;

  @ApiProperty({ example: 'DIY', required: false, description: 'Mapping dari region' })
  province?: string;

  @ApiProperty({ example: '55223', required: false })
  zip_code?: string;

  @ApiProperty({ example: 'ID', default: 'ID', required: false })
  country?: string;

  @ApiProperty({ example: '-7.782859', required: false })
  latitude?: string;

  @ApiProperty({ example: '110.367098', required: false })
  longitude?: string;

  @ApiProperty({ example: '0274123456', required: false })
  phone?: string;

  // ==========================================
  // LEVEL 2: ROOM TYPE FIELDS
  // ==========================================
  @ApiProperty({ example: 'Deluxe Suite', required: false })
  room_type_name?: string;

  @ApiProperty({ example: 2, required: false, description: 'Mapping dari guest' })
  room_capacity?: number;

  @ApiProperty({ example: 0, required: false, description: '0 = Non-Smoking, 1 = Smoking' })
  room_smoking?: number;

  @ApiProperty({ example: 'City View', required: false })
  room_view?: string;

  @ApiProperty({ example: 'https://cdn.com/image.jpg', required: false, description: 'Mapping dari filename' })
  room_image_url?: string;

  // ==========================================
  // LEVEL 3: RATE PLAN FIELDS
  // ==========================================
  @ApiProperty({ example: 'Room Only', required: false })
  rate_plan_name?: string;

  @ApiProperty({ example: 0, required: false, description: '0 = No, 1 = Yes (Mapping dari food)' })
  breakfast_included?: number;

  @ApiProperty({ example: 1, required: false, description: '0 = No, 1 = Yes' })
  pay_at_hotel?: number;
}

export class PropertyUpdateDto {
  @ApiProperty({ 
    example: 'hotel', 
    enum: ['hotel', 'room', 'rate_plan'], 
    description: `Determines which database update scope strategy to execute:
- hotel: Updates basic hotel profile configurations (e.g., name, address, phone, coordinates)
- room: Updates room type attributes (e.g., room name, capacities)
- rate_plan: Updates rate plan specifications and mapped pricing types`
  })
  updateType: 'hotel' | 'room' | 'rate_plan';

  @ApiProperty({ 
    type: [PropertyUpdateRowDto],
    description: 'List of partial change data rows matching table blueprint schema',
    example: [
      {
        hotel_id: 101,
        hotel_code: 'YK.143-V1Testing',
        hotel_name: 'Azana Hotel Yogyakarta',
        property_category: 'hotel',
        hotel_brand: 'Azana Style',
        street_address: 'Jl. Jend. Sudirman No. 45',
        city: 'Yogyakarta',
        province: 'DIY',
        zip_code: '55223',
        country: 'ID',
        latitude: '-7.782859',
        longitude: '110.367098',
        phone: '0274123456',
        room_type_id: 12,
        room_type_name: 'Deluxe Suite',
        room_capacity: 2,
        room_smoking: 0,
        room_view: 'City View',
        room_image_url: 'https://cdn.com/image.jpg',
        rate_plan_id: 45,
        rate_plan_name: 'Room Only',
        breakfast_included: 0,
        pay_at_hotel: 1
      }
    ]
  })
  data: PropertyUpdateRowDto[];
}