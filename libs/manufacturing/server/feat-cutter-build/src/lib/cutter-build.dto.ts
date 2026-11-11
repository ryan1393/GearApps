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
  ValidateIf,
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

  @ApiPropertyOptional({
    format: 'uuid', nullable: true,
    description: 'Cutter body definition (body type). Gives an unetched body (MF S/N only) its 064/076/088 rule; a 105 still needs its Dana S/N.',
  })
  @IsOptional()
  @IsUUID()
  definition_id?: string | null;
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
    description: 'Required only when teardown returns one or more blades. Scan a CGDR dull shelf for RING or CGDP for PINION, addressed by shelf letter, layer number and bin letter (CGDR-A1A).',
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
  /** Body definition (type); null unlinks it. */
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== null && value !== undefined) @IsUUID() definition_id?: string | null;
  @IsOptional() @IsString() @MaxLength(100) mf_serial_number?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
