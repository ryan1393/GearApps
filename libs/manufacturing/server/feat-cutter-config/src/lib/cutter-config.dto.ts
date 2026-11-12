import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

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

/** One Part Type group: omitted = unchanged; null or '' = clear. Positions are the fields themselves. */
export class SavePartTypeSettingsDto {
  @ApiPropertyOptional({ nullable: true, enum: ['RH', 'LH'], description: 'Workpiece Hand of Spiral for this Summary + Part Type' })
  @IsOptional() @IsString() @MaxLength(8) hos?: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'LH IB' }) @IsOptional() @IsString() @MaxLength(64) inner_blade?: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'RH IB', description: 'Kept exactly; an IB label may be the Outer blade' })
  @IsOptional() @IsString() @MaxLength(64) outer_blade?: string | null;
}

export class SavePartTypesDto {
  @ApiPropertyOptional({ type: SavePartTypeSettingsDto }) @IsOptional() @ValidateNested() @Type(() => SavePartTypeSettingsDto) RING?: SavePartTypeSettingsDto;
  @ApiPropertyOptional({ type: SavePartTypeSettingsDto }) @IsOptional() @ValidateNested() @Type(() => SavePartTypeSettingsDto) PINION?: SavePartTypeSettingsDto;
}

/** Save Part Summary: every submitted field in one transaction. Omitted fields stay as they are. */
export class SavePartSummaryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) revision?: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) @IsOptional() @IsUUID() model_id?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Summary-level HOS (part_summaries.hos)' }) @IsOptional() @IsString() @MaxLength(8) hos?: string | null;
  @ApiPropertyOptional({ type: SavePartTypesDto }) @IsOptional() @ValidateNested() @Type(() => SavePartTypesDto) part_types?: SavePartTypesDto;
  @ApiPropertyOptional({
    nullable: true, enum: ['064', '076', '088', '105', '105-SPECIAL'],
    description: 'Omitted keeps the current Body Size Rule; a code changes it (RING/PINION requirements follow); null clears it.',
  })
  @IsOptional() @IsIn(['064', '076', '088', '105', '105-SPECIAL']) body_rule?: string | null;
}
