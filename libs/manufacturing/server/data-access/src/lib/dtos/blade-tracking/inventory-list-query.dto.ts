import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationOptionsDto } from '../pagination';

export class InventoryListQueryDto extends PaginationOptionsDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: 'Search the operator-facing inventory fields for this asset type.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly search?: string;
}
