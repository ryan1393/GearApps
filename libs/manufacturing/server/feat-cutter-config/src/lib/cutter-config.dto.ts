import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateCutterBladeRequirementDto {
  @IsUUID() summary_id!: string;
  @IsUUID() part_type_id!: string;
  @Type(() => Number) @IsInt() @Min(1) required_blade_count!: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateCutterBladeRequirementDto {
  @IsOptional() @IsUUID() summary_id?: string;
  @IsOptional() @IsUUID() part_type_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) required_blade_count?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class ValidateCutterTrayDto {
  @IsUUID() summary_id!: string;
  @IsUUID() part_type_id!: string;
  @IsString() tray_serial_number!: string;
  /** Optional Dana or MF serial of the body the tray is for; the answer then includes body compatibility. */
  @ApiPropertyOptional({ description: 'Dana S/N (or MF S/N of an unetched body). When given, the tray is valid only for a compatible, free body.' })
  @IsOptional() @IsString() @MaxLength(100) cutter_body_identifier?: string;
}

export class CutterBodyCompatibilityQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() summary_id?: string;
}

export class SetSummaryBodyRuleDto {
  @ApiProperty({ enum: ['064', '076', '088', '105', '105-SPECIAL'], description: 'Approved cutter-body rule; it controls the Summary-based required quantity.' })
  @IsIn(['064', '076', '088', '105', '105-SPECIAL']) body_rule!: string;
}
