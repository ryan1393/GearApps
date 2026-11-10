import { IBaseEntity, Uuid } from '@gearapps/manufacturing/shared/util-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AbstractOrmEntity } from '../database';

export type AbstractDtoOptions = Partial<{ excludeFields?: string[] }>;

export class AbstractDto implements IBaseEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
  })
  deletedAt?: Date | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
  })
  deletedBy?: string | null;

  constructor(entity: AbstractOrmEntity, opts?: AbstractDtoOptions) {
    this.id = entity.id;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
    this.createdBy = entity.createdBy;
    this.updatedBy = entity.updatedBy;
    if (opts) {
      // do stuff!
    }
  }
}
