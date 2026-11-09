import { ApiProperty } from '@nestjs/swagger';

import { AbstractDto, AbstractDtoOptions } from '@gearapps/manufacturing/server/util-common';
import { Uuid } from '@gearapps/manufacturing/shared/util-types';
import { ContainerTrayOrmEntity } from '../../../database/entities/blade-tracking/container-tray.orm-entity';


export type ContainerTrayDtoOptions = AbstractDtoOptions;

export class ContainerTrayDto extends AbstractDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  tray_id!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  container_id!: string;

  @ApiProperty()
  enabled!: boolean;

  constructor(
    containerTray: ContainerTrayOrmEntity,
    opts?: ContainerTrayDtoOptions,
  ) {
    super(containerTray, opts);

    this.tray_id = containerTray.tray_id;
    this.container_id = containerTray.container_id;
    this.enabled = containerTray.enabled;
  }
}
