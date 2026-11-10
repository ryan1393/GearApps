import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Piece counts are stored in PostgreSQL integer columns; a larger value (e.g. a barcode scanned into the field) must be a 400, not a database error. */
const MAX_PIECE_COUNT = 2147483647;

export class SetupCutterDto {
  @ApiProperty()
  @IsString()
  build_number!: string;

  @ApiProperty()
  @IsString()
  machine_number!: string;

  @ApiProperty({ description: 'Actual production Part Number from the Parts master table.' })
  @IsString()
  part_number!: string;

  @ApiPropertyOptional({ description: 'Production shift shown on the Running Machines board.' })
  @IsOptional()
  @IsString()
  shift?: string | null;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PIECE_COUNT)
  starting_piece_count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string | null;
}


export class FrequencyCheckMeasurementsDto {
  @IsOptional() @Type(() => Number) @IsNumber() s_e_square?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() s_e_after?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() s_e_result?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() total_fr?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() tooth_thickness?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank1_pa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank1_sa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank2_pa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank2_sa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() size_check?: number | null;
}

export class CmmCheckMeasurementsDto {
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_pa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_sa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_fp?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_fp_small?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_fu?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_frs?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_warp?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_toe_root?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_toe_top?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_heel_root?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_1_heel_top?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber() flank_2_pa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_sa?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_fp?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_fp_small?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_fu?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_frs?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_warp?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_toe_root?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_toe_top?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_heel_root?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() flank_2_heel_top?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber() tooth_thickness?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() total_fr?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() sum_error_squared?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() sum_error_after?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() result?: number | null;
}

export class QualityCheckDto {
  @ApiPropertyOptional({ description: 'Machine shown when the check was opened.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  expected_machine_number?: string;

  @ApiPropertyOptional({ description: 'Active run shown when the check was opened.' })
  @IsOptional()
  @IsUUID()
  expected_machine_run_id?: string;

  @ApiProperty()
  @IsString()
  build_number!: string;

  @ApiProperty({ description: 'FC or CMM' })
  @IsString()
  check_type_code!: string;

  @ApiProperty({ description: 'PASS, FAIL, or HOLD' })
  @IsString()
  result_code!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PIECE_COUNT)
  piece_count!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string | null;

  @ApiPropertyOptional({ type: FrequencyCheckMeasurementsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FrequencyCheckMeasurementsDto)
  frequency?: FrequencyCheckMeasurementsDto;

  @ApiPropertyOptional({ type: CmmCheckMeasurementsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CmmCheckMeasurementsDto)
  cmm?: CmmCheckMeasurementsDto;
}

export class UpdatePieceCountDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PIECE_COUNT)
  piece_count!: number;
}

export class PullCutterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  expected_machine_number?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  expected_machine_run_id?: string;

  @ApiProperty()
  @IsString()
  build_number!: string;

  @ApiProperty({ description: 'Database pull-reason code' })
  @IsString()
  reason_code!: string;

  @ApiPropertyOptional({
    description: 'Required for a changeover returning the intact cutter to its part-specific Green Shed summary shelf (GSR-<summary> for RING or GSP-<summary> for PINION)',
  })
  @IsOptional()
  @IsString()
  shelf_location_serial_number?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string | null;
}
