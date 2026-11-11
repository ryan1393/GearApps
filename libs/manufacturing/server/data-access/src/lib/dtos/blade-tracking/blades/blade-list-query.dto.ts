import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { BladeStatus } from '@meshforge/manufacturing/shared/util-types';
import { PaginationOptionsDto } from '../../pagination';

export class BladeListQueryDto extends PaginationOptionsDto {
  @ApiPropertyOptional({ enum: BladeStatus })
  @IsOptional()
  @IsEnum(BladeStatus)
  readonly status?: BladeStatus;

  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: 'Search blade serial, Summary number, or Part Type code.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly search?: string;
}
