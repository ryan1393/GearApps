import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ICreatePartSummary } from '@meshforge/manufacturing/shared/util-types';

export class CreatePartSummaryDto implements ICreatePartSummary {
  @ApiProperty() @IsString() number!: string;
  @ApiPropertyOptional({ default: '' }) @IsOptional() @IsString() revision = '';
  @ApiPropertyOptional() @IsOptional() @IsUUID() model_id!: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() hos!: string | null;
  @ApiProperty({ default: true }) @IsBoolean() active!: boolean;
  @ApiProperty({ default: true }) @IsBoolean() enabled!: boolean;
}
