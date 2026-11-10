import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
