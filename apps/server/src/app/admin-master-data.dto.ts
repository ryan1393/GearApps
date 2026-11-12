import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Model numbers are text ("174", "S-110", "9¼"). Numbers are still accepted from older clients
 * and stored as their text; blanks become null.
 */
const ModelNumber = () =>
  Transform(({ value }) =>
    value === undefined ? undefined
      : value === null ? null
      : typeof value === 'number' ? String(value)
      : typeof value === 'string' ? value.trim() || null
      : value,
  );

export class CreateAdminModelDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'S-110' })
  @ModelNumber() @IsOptional() @IsString() @MaxLength(100)
  model_number?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsString() @MaxLength(100)
  model_type?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  active?: boolean = true;
}

export class UpdateAdminModelDto {
  @ModelNumber() @IsOptional() @IsString() @MaxLength(100) model_number?: string | null;
  @IsOptional() @IsString() @MaxLength(100) model_type?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class CreateAdminMachineDto {
  @ApiProperty()
  @IsString() @MaxLength(100)
  machine_number!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  department_id!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Type(() => Number) @IsInt()
  cell?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsString() @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ enum: ['PRODUCTION', 'CUTTER_BUILDER', 'GRINDER'], default: 'PRODUCTION' })
  @IsOptional() @IsIn(['PRODUCTION', 'CUTTER_BUILDER', 'GRINDER'])
  machine_type?: 'PRODUCTION' | 'CUTTER_BUILDER' | 'GRINDER' = 'PRODUCTION';

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  active?: boolean = true;
}

export class UpdateAdminMachineDto {
  @IsOptional() @IsString() @MaxLength(100) machine_number?: string;
  @IsOptional() @IsUUID() department_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() cell?: number | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsIn(['PRODUCTION', 'CUTTER_BUILDER', 'GRINDER']) machine_type?: 'PRODUCTION' | 'CUTTER_BUILDER' | 'GRINDER';
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
