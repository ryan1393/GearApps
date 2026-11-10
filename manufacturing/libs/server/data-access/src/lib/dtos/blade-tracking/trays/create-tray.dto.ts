import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ICreateTray } from '@gearapps/manufacturing/shared/util-types';

export class CreateTrayDto implements ICreateTray {
  @ApiProperty({ type: String })
  @IsString()
  serial_number!: string;

  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  blade_count?: number;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
