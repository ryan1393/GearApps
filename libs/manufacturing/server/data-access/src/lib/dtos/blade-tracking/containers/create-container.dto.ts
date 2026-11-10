import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

import { ICreateContainer } from '@gearapps/manufacturing/shared/util-types';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class CreateContainerDto implements ICreateContainer {
  @ApiProperty({
    type: String,
  })
  @IsString()
  serial_number!: string;

  @ApiProperty({
    type: Boolean,
  })
  @IsBoolean()
  enabled!: boolean;
}
