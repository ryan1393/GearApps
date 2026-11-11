import {
  CheckCmm,
  CheckFrequency,
  CreateCheckCmm,
  CreateCheckFrequency,
  CreateCutterBuild,
  CreateCutterLog,
  CreatePullCutterReason,
  CreateRetiredCutter,
  CutterBuild,
  CutterLog,
  PullCutterReason,
  RetiredCutter,
  UpdateCheckCmm,
  UpdateCheckFrequency,
  UpdateCutterBuild,
  UpdateCutterLog,
  UpdatePullCutterReason,
  UpdateRetiredCutter,
} from '@meshforge/shared/domain';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const uuidExample = 'DCA76BCC-F6CD-4211-A9F5-CD4E24381EC8';

export class CutterLogDto implements CutterLog {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID() id!: string;
  @ApiProperty({ example: 'B-1001' }) @IsString() @IsNotEmpty() build_id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() toc_id!: string;
  @ApiProperty({ example: 250 }) @IsInt() part_count!: number;
  @ApiProperty({ example: uuidExample }) @IsUUID() part_id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() machine_id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() user_id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) @Type(() => Date) @IsDate() timestamp!: Date;
}
export class CreateCutterLogDto extends OmitType(CutterLogDto, ['id']) implements CreateCutterLog {}
export class UpdateCutterLogDto
  extends PartialType(CreateCutterLogDto)
  implements UpdateCutterLog {}

export class PullCutterReasonDto implements PullCutterReason {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID() id!: string;
  @ApiProperty({ example: 'Chipped blade' }) @IsString() @IsNotEmpty() description!: string;
}
export class CreatePullCutterReasonDto
  extends OmitType(PullCutterReasonDto, ['id'])
  implements CreatePullCutterReason {}
export class UpdatePullCutterReasonDto
  extends PartialType(CreatePullCutterReasonDto)
  implements UpdatePullCutterReason {}

export class CutterBuildDto implements CutterBuild {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID() id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() log_id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() summary_id!: string;
  @ApiProperty({ example: 'Pinion' }) @IsString() @IsNotEmpty() part_type!: string;
  @ApiProperty() @IsBoolean() honed!: boolean;
  @ApiProperty() @IsBoolean() coated!: boolean;
  @ApiProperty({ example: 0.0012 }) @IsNumber() ib_ro!: number;
  @ApiProperty({ example: 0.0015 }) @IsNumber() ob_ro!: number;
  @ApiProperty({ readOnly: true, example: 17 }) @IsInt() number!: number;
  @ApiProperty({ example: 'CB-42' }) @IsString() @IsNotEmpty() cutter_body_id!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() comment!: string | null;
}
export class CreateCutterBuildDto
  extends OmitType(CutterBuildDto, ['id', 'number'])
  implements CreateCutterBuild {}
export class UpdateCutterBuildDto
  extends PartialType(CreateCutterBuildDto)
  implements UpdateCutterBuild {}

export class CheckCmmDto implements CheckCmm {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID() id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() log_id!: string;
  @ApiProperty() @IsBoolean() pass_fail!: boolean;
  @ApiProperty() @IsNumber() flank_1_Pa!: number;
  @ApiProperty() @IsNumber() flank_1_Sa!: number;
  @ApiProperty() @IsNumber() flank_1_Fp!: number;
  @ApiProperty() @IsNumber() flank_1__fp!: number;
  @ApiProperty() @IsNumber() flank_1_fu!: number;
  @ApiProperty() @IsNumber() flank_1_Frs!: number;
  @ApiProperty() @IsNumber() flank_1_warp!: number;
  @ApiProperty() @IsNumber() flank_1_toe_root!: number;
  @ApiProperty() @IsNumber() flank_1_toe_top!: number;
  @ApiProperty() @IsNumber() flank_1_heel_root!: number;
  @ApiProperty() @IsNumber() flank_1_heel_top!: number;
  @ApiProperty() @IsNumber() flank_2_Pa!: number;
  @ApiProperty() @IsNumber() flank_2_Sa!: number;
  @ApiProperty() @IsNumber() flank_2_Fp!: number;
  @ApiProperty() @IsNumber() flank_2__fp!: number;
  @ApiProperty() @IsNumber() flank_2_fu!: number;
  @ApiProperty() @IsNumber() flank_2_Frs!: number;
  @ApiProperty() @IsNumber() flank_2_warp!: number;
  @ApiProperty() @IsNumber() flank_2_toe_root!: number;
  @ApiProperty() @IsNumber() flank_2_toe_top!: number;
  @ApiProperty() @IsNumber() flank_2_heel_root!: number;
  @ApiProperty() @IsNumber() flank_2_heel_top!: number;
  @ApiProperty() @IsNumber() sum_Error_squared!: number;
  @ApiProperty() @IsNumber() sum_Error_after!: number;
  @ApiProperty() @IsNumber() result!: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() comment!: string | null;
}
export class CreateCheckCmmDto extends OmitType(CheckCmmDto, ['id']) implements CreateCheckCmm {}
export class UpdateCheckCmmDto extends PartialType(CreateCheckCmmDto) implements UpdateCheckCmm {}

export class CheckFrequencyDto implements CheckFrequency {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID() id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() log_id!: string;
  @ApiProperty() @IsBoolean() pass_fail!: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() s_e_sqaure!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() s_e_after!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() total_fr!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() tooth_thickness!:
    number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() flank1_pa!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() flank1_sa!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() flank2_pa!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() flank2_sa!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() size_check!: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() comment!: string | null;
}
export class CreateCheckFrequencyDto
  extends OmitType(CheckFrequencyDto, ['id'])
  implements CreateCheckFrequency {}
export class UpdateCheckFrequencyDto
  extends PartialType(CreateCheckFrequencyDto)
  implements UpdateCheckFrequency {}

export class RetiredCutterDto implements RetiredCutter {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID() id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() log_id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID() pcr_id!: string;
  @ApiProperty() @IsBoolean() cuttergrind_verified!: boolean;
  @ApiProperty() @IsString() comments!: string;
}
export class CreateRetiredCutterDto
  extends OmitType(RetiredCutterDto, ['id'])
  implements CreateRetiredCutter {}
export class UpdateRetiredCutterDto
  extends PartialType(CreateRetiredCutterDto)
  implements UpdateRetiredCutter {}
