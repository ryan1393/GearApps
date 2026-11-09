import { ApiProperty } from '@nestjs/swagger';

import { AbstractDto, AbstractDtoOptions } from '@libs/server/util-common';
import { Uuid } from '@libs/shared/util-types';
import { LocationTrayOrmEntity } from '../../../database/entities/blade-tracking/location-tray.orm-entity';


export type LocationTrayDtoOptions = AbstractDtoOptions;

export class LocationTrayDto extends AbstractDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  tray_id!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  location_id!: string;

  @ApiProperty()
  enabled!: boolean;

  constructor(
    locationTray: LocationTrayOrmEntity,
    opts?: LocationTrayDtoOptions,
  ) {
    super(locationTray, opts);

    this.tray_id = locationTray.tray_id;
    this.location_id = locationTray.location_id;
    this.enabled = locationTray.enabled;
  }
}
