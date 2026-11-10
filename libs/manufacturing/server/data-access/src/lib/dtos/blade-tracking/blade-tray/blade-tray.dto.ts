import { ApiProperty } from '@nestjs/swagger';

import { AbstractDto, AbstractDtoOptions } from '@gearapps/manufacturing/server/util-common';
import { BladeTrayOrmEntity } from '../../../database/entities/blade-tracking/blade-tray.orm-entity';
import { Uuid } from '@gearapps/manufacturing/shared/util-types';


export type BladeTrayDtoOptions = AbstractDtoOptions;

export class BladeTrayDto extends AbstractDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  tray_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  blade_id: string;

  @ApiProperty()
  enabled!: boolean;

  constructor(
    bladeTray: BladeTrayOrmEntity,
    opts?: BladeTrayDtoOptions,
  ) {
    super(bladeTray, opts);

    this.tray_id = bladeTray.tray_id;
    this.blade_id = bladeTray.blade_id;
    this.enabled = bladeTray.enabled;
  }
}
