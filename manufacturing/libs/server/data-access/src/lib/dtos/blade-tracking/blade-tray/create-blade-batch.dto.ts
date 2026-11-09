import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BladeStatus, Uuid } from '@gearapps/manufacturing/shared/util-types';

export class CreateBladeBatchDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  tray_id!: Uuid;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  summary_id!: Uuid;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  part_type_id!: Uuid;

  @ApiProperty({ type: Number, minimum: 1, maximum: 500 })
  @IsInt()
  @Min(1)
  @Max(500)
  quantity!: number;

  @ApiPropertyOptional({ enum: [BladeStatus.NEW, BladeStatus.GRINDING, BladeStatus.WAITING_FOR_GRINDING], default: BladeStatus.NEW })
  @IsOptional()
  @IsIn([BladeStatus.NEW, BladeStatus.GRINDING, BladeStatus.WAITING_FOR_GRINDING])
  status?: BladeStatus;

  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  service_cycle?: number;
}
