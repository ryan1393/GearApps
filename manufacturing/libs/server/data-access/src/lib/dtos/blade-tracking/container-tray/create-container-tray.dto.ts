import {
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

import { ICreateContainerTray, Uuid } from '@libs/shared/util-types';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class CreateContainerTrayDto implements ICreateContainerTray {
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
  container_id!: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
