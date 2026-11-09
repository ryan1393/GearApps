import {
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

import { ICreateLocationTray, Uuid } from '@libs/shared/util-types';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class CreateLocationTrayDto implements ICreateLocationTray {
  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  @IsString()
  tray_id!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  @IsString()
  location_id!: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
