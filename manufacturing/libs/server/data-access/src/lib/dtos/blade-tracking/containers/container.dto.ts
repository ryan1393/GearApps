import { ApiProperty } from '@nestjs/swagger';

import { AbstractDto, AbstractDtoOptions } from '@gearapps/manufacturing/server/util-common';
import { ContainerOrmEntity } from '../../../database/entities/blade-tracking/container.orm-entity';


export type ContainerDtoOptions = AbstractDtoOptions;

export class ContainerDto extends AbstractDto {
  @ApiProperty()
  serial_number!: string;

  @ApiProperty()
  enabled!: boolean;

  constructor(
    container: ContainerOrmEntity,
    opts?: ContainerDtoOptions,
  ) {
    super(container, opts);

    this.serial_number = container.serial_number;
    this.enabled = container.enabled;
  }
}
