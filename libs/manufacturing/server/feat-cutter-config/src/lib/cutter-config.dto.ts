import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
}

export class SetSummaryBodyRuleDto {
  @ApiProperty({ enum: ['064', '076', '088', '105', '105-SPECIAL'], description: 'Approved cutter-body rule; it controls the Summary-based required quantity.' })
  @IsIn(['064', '076', '088', '105', '105-SPECIAL']) body_rule!: string;
}
