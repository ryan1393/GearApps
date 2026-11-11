import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AbstractDto, AbstractDtoOptions } from '@meshforge/manufacturing/server/util-common';
import { LocationOrmEntity } from '../../../database/entities/blade-tracking/location.orm-entity';


export type LocationDtoOptions = AbstractDtoOptions;

export class LocationDto extends AbstractDto {
  @ApiProperty()
  serial_number!: string;

  @ApiProperty()
  number!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
  })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  department!: string | null;

  @ApiProperty()
  location_type!: string;

  @ApiProperty()
  enabled!: boolean;

  constructor(
    location: LocationOrmEntity,
    opts?: LocationDtoOptions,
  ) {
    super(location, opts);

    this.serial_number = location.serial_number;
    this.number = location.number;
    this.description = location.description;
    this.department = location.department;
    this.location_type = location.location_type;
    this.enabled = location.enabled;
  }
}
