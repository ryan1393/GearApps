import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCutterBodyDto {
  @ApiPropertyOptional({
    description: 'Dana serial number. Leave blank until the cutter body is etched.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dana_serial_number?: string | null;

  @ApiProperty({
    description: 'Manufacturer / MF serial number. Required permanent cutter-body identifier.',
  })
  @IsString()
  @MaxLength(100)
  mf_serial_number!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}


export class AssignCutterBodyDanaSerialDto {
  @ApiProperty({
    description: 'Dana serial etched onto the existing cutter body.',
  })
  @IsString()
  @MaxLength(100)
  dana_serial_number!: string;
}

export class CreateCutterBuilderBuildDto {
  @ApiProperty({
    description: 'Dana serial when etched, otherwise manufacturer / MF serial.',
  })
  @IsString()
  cutter_body_identifier!: string;

  @ApiProperty()
  @IsString()
  tray_serial_number!: string;

  @ApiProperty({ format: 'uuid', description: 'Enabled Department 45 machine with Cutter Builder machine type.' })
  @IsUUID()
  cutter_builder_machine_id!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  honed?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  coated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ib_ro?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ob_ro?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string | null;
}

export class CreateCutterTeardownDto {
  @ApiProperty()
  @IsString()
  build_number!: string;

  @ApiProperty()
  @IsString()
  teardown_tray_serial_number!: string;

  @ApiPropertyOptional({
    description: 'Required only when teardown returns one or more blades. Scan CGDR-<summary> for RING or CGDP-<summary> for PINION.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  shelf_location_serial_number?: string | null;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  scrapped_blade_count!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string | null;
}


export class UpdateCutterBodyDto {
  @IsOptional() @IsString() @MaxLength(100) dana_serial_number?: string | null;
  @IsOptional() @IsString() @MaxLength(100) mf_serial_number?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
