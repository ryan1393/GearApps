import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ICreatePartSummary } from '@meshforge/manufacturing/shared/util-types';

export class CreatePartSummaryDto implements ICreatePartSummary {
  @ApiProperty() @IsString() number!: string;
  // No property initializer: UpdatePartSummaryDto (PartialType) would inherit it and blank the
  // revision on every partial update that omits it. Create applies the '' default instead.
  @ApiPropertyOptional({ default: '' }) @IsOptional() @IsString() revision!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() model_id!: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() hos!: string | null;
  @ApiProperty({ default: true }) @IsBoolean() active!: boolean;
  @ApiProperty({ default: true }) @IsBoolean() enabled!: boolean;
}
