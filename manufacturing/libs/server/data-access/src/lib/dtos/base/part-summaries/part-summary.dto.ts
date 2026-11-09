import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AbstractDto, AbstractDtoOptions } from '@gearapps/manufacturing/server/util-common';
import { PartSummaryOrmEntity } from '../../../database/entities/base/part-summary.orm-entity';

export type PartSummaryDtoOptions = AbstractDtoOptions;

export class PartSummaryDto extends AbstractDto {
  @ApiProperty() number!: string;
  @ApiPropertyOptional() revision!: string;
  @ApiPropertyOptional() model_id!: string | null;
  @ApiPropertyOptional() hos!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() enabled!: boolean;

  constructor(partSummary: PartSummaryOrmEntity, opts?: PartSummaryDtoOptions) {
    super(partSummary, opts);
    this.number = partSummary.number;
    this.revision = partSummary.revision;
    this.model_id = partSummary.model_id;
    this.hos = partSummary.hos;
    this.active = partSummary.active;
    this.enabled = partSummary.enabled;
  }
}
