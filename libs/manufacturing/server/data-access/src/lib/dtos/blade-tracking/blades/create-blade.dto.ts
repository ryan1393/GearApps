import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BladeStatus, ICreateBlade, Uuid } from '@gearapps/manufacturing/shared/util-types';

export class CreateBladeDto implements ICreateBlade {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  summary_id!: Uuid;

  @ApiProperty({ type: String, description: 'Unique barcode/serial number for the physical blade.' })
  @IsString()
  serial_number!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  part_type_id!: Uuid;

  @ApiPropertyOptional({ enum: BladeStatus, default: BladeStatus.NEW })
  @IsOptional()
  @IsEnum(BladeStatus)
  status?: BladeStatus;

  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  service_cycle?: number;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
