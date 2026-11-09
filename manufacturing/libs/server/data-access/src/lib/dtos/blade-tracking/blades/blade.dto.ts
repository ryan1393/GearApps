import { ApiProperty } from '@nestjs/swagger';

import { AbstractDto, AbstractDtoOptions } from '@gearapps/manufacturing/server/util-common';
import { BladeStatus } from '@gearapps/manufacturing/shared/util-types';
import { BladeOrmEntity } from '../../../database/entities/blade-tracking/blade.orm-entity';

export type BladeDtoOptions = AbstractDtoOptions;

export class BladeDto extends AbstractDto {
  @ApiProperty({ type: String, format: 'uuid' })
  summary_id!: string;

  @ApiProperty()
  serial_number!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  part_type_id!: string;

  @ApiProperty({ enum: BladeStatus })
  status!: BladeStatus;

  @ApiProperty()
  service_cycle!: number;

  @ApiProperty()
  enabled!: boolean;

  constructor(blade: BladeOrmEntity, opts?: BladeDtoOptions) {
    super(blade, opts);
    this.summary_id = blade.summary_id;
    this.serial_number = blade.serial_number;
    this.part_type_id = blade.part_type_id;
    this.status = blade.status;
    this.service_cycle = blade.service_cycle;
    this.enabled = blade.enabled;
  }
}
