import {
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

import { ICreateBladeTray, Uuid } from '@libs/shared/util-types';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class CreateBladeTrayDto implements ICreateBladeTray {
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
  blade_id!: string;

  @ApiProperty({
    type: Boolean,
  })
  @IsBoolean()
  enabled!: boolean;
}
