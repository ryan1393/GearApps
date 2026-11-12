import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_DEFAULT_PER_PAGE,
} from '@meshforge/manufacturing/shared/util-constants';
import { IPaginationOptions, SortOrderType } from '@meshforge/manufacturing/shared/util-types';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

export class PaginationOptionsDto implements IPaginationOptions {
  @ApiProperty({
    enum: SortOrderType,
    default: SortOrderType.ASC,
    required: false,
  })
  @IsEnum(SortOrderType)
  @IsOptional()
  readonly order?: SortOrderType;

  @ApiProperty({
    type: Number,
    minimum: 1,
    default: PAGINATION_DEFAULT_PAGE,
    required: false,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  readonly page?: number;

  @ApiProperty({
    type: Number,
    minimum: 1,
    default: PAGINATION_DEFAULT_PER_PAGE,
    maximum: PAGINATION_DEFAULT_LIMIT,
    required: false,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_DEFAULT_LIMIT)
  @IsOptional()
  readonly perPage?: number;

  @ApiProperty({
    type: Number,
    minimum: 1,
    default: PAGINATION_DEFAULT_LIMIT,
    maximum: PAGINATION_DEFAULT_LIMIT,
    required: false,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_DEFAULT_LIMIT)
  @IsOptional()
  readonly limit?: number;

  @ApiHideProperty()
  get skip(): number | undefined {
    return this.page && this.perPage
      ? (this.page - 1) * this.perPage
      : undefined;
  }
}
