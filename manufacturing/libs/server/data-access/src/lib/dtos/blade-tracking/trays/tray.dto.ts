import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AbstractDto, AbstractDtoOptions } from '@libs/server/util-common';
import { TrayOrmEntity } from '../../../database/entities/blade-tracking/tray.orm-entity';

export type TrayDtoOptions = AbstractDtoOptions;

export class TrayDto extends AbstractDto {
  @ApiProperty()
  serial_number!: string;

  @ApiProperty()
  blade_count!: number;

  @ApiPropertyOptional()
  summary_id!: string | null;

  @ApiPropertyOptional()
  part_type_id!: string | null;

  @ApiPropertyOptional()
  grinding_completed_at!: Date | null;

  @ApiPropertyOptional()
  required_blade_count!: number | null;

  @ApiPropertyOptional()
  current_stage_id!: string | null;

  @ApiProperty()
  enabled!: boolean;

  constructor(tray: TrayOrmEntity, opts?: TrayDtoOptions) {
    super(tray, opts);
    this.serial_number = tray.serial_number;
    this.blade_count = tray.blade_count;
    this.summary_id = tray.summary_id;
    this.part_type_id = tray.part_type_id;
    this.grinding_completed_at = tray.grinding_completed_at;
    this.required_blade_count = tray.required_blade_count;
    this.current_stage_id = tray.current_stage_id;
    this.enabled = tray.enabled;
  }
}
