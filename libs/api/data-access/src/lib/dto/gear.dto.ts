import {
  CreateDepartment,
  CreateGearset,
  CreateGearsetMarriage,
  CreateMachine,
  CreateMachineCycle,
  CreateMachineFanucVariable,
  CreateMacro,
  CreateMacroLog,
  CreatePart,
  CreateScannerDetail,
  CreateSummary,
  CreateTypeOfCheck,
  Department,
  Gearset,
  GearsetMarriage,
  LappingSummaryRow,
  Machine,
  MachineCycle,
  MachineFanucVariable,
  Macro,
  MacroLog,
  Part,
  PART_TYPES,
  ScannerDetail,
  Summary,
  TypeOfCheck,
  UpdateDepartment,
  UpdateGearset,
  UpdateGearsetMarriage,
  UpdateMachine,
  UpdateMachineCycle,
  UpdateMachineFanucVariable,
  UpdateMacro,
  UpdateMacroLog,
  UpdatePart,
  UpdateScannerDetail,
  UpdateScannerSerialNumbers,
  UpdateSummary,
  UpdateTypeOfCheck,
} from '@meshforge/shared/domain';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsIP,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const uuidExample = 'DCA76BCC-F6CD-4211-A9F5-CD4E24381EC8';
// SQL Server uniqueidentifier values need not carry RFC UUID version bits.
// Keep their exact IDs during migration; validate the full GUID shape instead.

// ---------- Department ----------
export class DepartmentDto implements Department {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: 181 }) @IsInt() number!: number;
  @ApiProperty({ example: 'Gear Lapping' }) @IsString() @IsNotEmpty() description!: string;
}
export class CreateDepartmentDto
  extends OmitType(DepartmentDto, ['id'])
  implements CreateDepartment {}
export class UpdateDepartmentDto
  extends PartialType(CreateDepartmentDto)
  implements UpdateDepartment {}

// ---------- Type of Check ----------
export class TypeOfCheckDto implements TypeOfCheck {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: 'CMM' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: 'Coordinate measuring machine check' })
  @IsString()
  @IsNotEmpty()
  description!: string;
}
export class CreateTypeOfCheckDto
  extends OmitType(TypeOfCheckDto, ['id'])
  implements CreateTypeOfCheck {}
export class UpdateTypeOfCheckDto
  extends PartialType(CreateTypeOfCheckDto)
  implements UpdateTypeOfCheck {}

// ---------- Summary ----------
export class SummaryDto implements Summary {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: '220' }) @IsString() @IsNotEmpty() number!: string;
  @ApiProperty({ example: 'S-220' }) @IsString() @IsNotEmpty() model!: string;
  @ApiProperty({ example: '3.73' }) @IsString() @IsNotEmpty() hos!: string;
  @ApiProperty({ example: 'Active' }) @IsString() @IsNotEmpty() status!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID('loose') user_id!: string;
}
export class CreateSummaryDto extends OmitType(SummaryDto, ['id']) implements CreateSummary {}
export class UpdateSummaryDto
  extends PartialType(PickType(SummaryDto, ['status', 'user_id']))
  implements UpdateSummary {}

// ---------- Part ----------
export class PartDto implements Part {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: '12345-A' }) @IsString() @IsNotEmpty() number!: string;
  @ApiProperty({ enum: PART_TYPES, example: 'Pinion' }) @IsIn([...PART_TYPES]) type!: string;
  @ApiPropertyOptional({ example: uuidExample, nullable: true })
  @IsOptional()
  @IsUUID('loose')
  summary_id!: string | null;
  @ApiPropertyOptional({
    example: 11,
    nullable: true,
    description: 'Teeth (pinion/ring) or ratio (gearset)',
  })
  @IsOptional()
  @IsNumber()
  teeth!: number | null;
  @ApiProperty({ example: 'Active' }) @IsString() @IsNotEmpty() status!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID('loose') user_id!: string;
  @ApiPropertyOptional({ example: uuidExample, nullable: true })
  @IsOptional()
  @IsUUID('loose')
  ring_id?: string | null;
  @ApiPropertyOptional({ example: uuidExample, nullable: true })
  @IsOptional()
  @IsUUID('loose')
  pinion_id?: string | null;
}
export class CreatePartDto extends OmitType(PartDto, ['id']) implements CreatePart {}
export class UpdatePartDto
  extends PartialType(PickType(PartDto, ['status', 'user_id', 'summary_id', 'teeth']))
  implements UpdatePart {}

// ---------- Gearset ----------
export class GearsetDto implements Gearset {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: 'GS-100' }) @IsString() @IsNotEmpty() number!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() rev!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 3.73 }) @IsOptional() @IsNumber() ratio!:
    number | null;
  @ApiProperty({ example: 'Active' }) @IsString() @IsNotEmpty() status!: string;
  @ApiPropertyOptional({ nullable: true, example: uuidExample })
  @IsOptional()
  @IsUUID('loose')
  summary_id!: string | null;
  @ApiPropertyOptional({ nullable: true, example: uuidExample })
  @IsOptional()
  @IsUUID('loose')
  pinion_id!: string | null;
  @ApiPropertyOptional({ nullable: true, example: uuidExample })
  @IsOptional()
  @IsUUID('loose')
  ring_id!: string | null;
  @ApiPropertyOptional({ nullable: true, example: uuidExample })
  @IsOptional()
  @IsUUID('loose')
  user_id!: string | null;
}
export class CreateGearsetDto extends OmitType(GearsetDto, ['id']) implements CreateGearset {}
export class UpdateGearsetDto
  extends PartialType(PickType(GearsetDto, ['rev', 'status', 'user_id']))
  implements UpdateGearset {}

export class GearsetMarriageDto implements GearsetMarriage {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() rev!: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID('loose') gearset_id!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID('loose') pinion_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID('loose') ring_id!: string | null;
}
export class CreateGearsetMarriageDto
  extends OmitType(GearsetMarriageDto, ['id'])
  implements CreateGearsetMarriage {}
export class UpdateGearsetMarriageDto
  extends PartialType(PickType(GearsetMarriageDto, ['rev']))
  implements UpdateGearsetMarriage {}

// ---------- Scanner detail ----------
export class ScannerDetailDto implements ScannerDetail {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiPropertyOptional({ nullable: true, example: '10.16.80.68' }) @IsOptional() @IsIP(4) ip!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'SR-2000' }) @IsOptional() @IsString() model!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Barcode' }) @IsOptional() @IsString() type!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() description!: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() sn_procces!: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() sn_queue!: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() sn_scanner!: string | null;
  @ApiProperty({ example: 'Active' }) @IsString() @IsNotEmpty() status!: string;
  @ApiPropertyOptional({ nullable: true, example: uuidExample })
  @IsOptional()
  @IsUUID('loose')
  machine_id!: string | null;
}
export class CreateScannerDetailDto
  extends OmitType(ScannerDetailDto, ['id'])
  implements CreateScannerDetail {}
export class UpdateScannerDetailDto
  extends PartialType(CreateScannerDetailDto)
  implements UpdateScannerDetail {}
export class UpdateScannerSerialNumbersDto
  extends PartialType(PickType(ScannerDetailDto, ['sn_procces', 'sn_queue', 'sn_scanner']))
  implements UpdateScannerSerialNumbers {}

// ---------- Machine ----------
export class MachineDto implements Machine {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiPropertyOptional({ nullable: true, example: '01-094-999', description: 'Asset ID' })
  @IsOptional()
  @IsString()
  number!: string | null;
  @ApiProperty({ example: '10.16.80.174' }) @IsIP(4) ip!: string;
  @ApiPropertyOptional({ nullable: true, example: '181' }) @IsOptional() @IsString() dept_id!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Lapper' })
  @IsOptional()
  @IsString()
  description!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'L-60' }) @IsOptional() @IsString() type!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Klingelnberg' })
  @IsOptional()
  @IsString()
  builder!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '15' }) @IsOptional() @IsString() cell!:
    string | null;
  @ApiProperty({ example: 'Active' }) @IsString() @IsNotEmpty() status!: string;
  @ApiPropertyOptional({ nullable: true, example: uuidExample })
  @IsOptional()
  @IsUUID('loose')
  scanner_id?: string | null;
}
export class CreateMachineDto extends OmitType(MachineDto, ['id']) implements CreateMachine {}
export class UpdateMachineDto
  extends PartialType(OmitType(MachineDto, ['id', 'number']))
  implements UpdateMachine {}

// ---------- Machine cycle ----------
export class MachineCycleDto implements MachineCycle {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID('loose') machine_id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID('loose') gearset_id!: string;
  @ApiPropertyOptional({ nullable: true, example: 'SN-0001' })
  @IsOptional()
  @IsString()
  serial_number!: string | null;
  @ApiProperty({ example: 42 }) @IsInt() consec!: number;
  @ApiProperty({ type: String, format: 'date-time' }) @Type(() => Date) @IsDate() timestamp!: Date;
}
export class CreateMachineCycleDto
  extends OmitType(MachineCycleDto, ['id'])
  implements CreateMachineCycle {}
export class UpdateMachineCycleDto
  extends PartialType(CreateMachineCycleDto)
  implements UpdateMachineCycle {}

// ---------- Fanuc variables ----------
export class MachineFanucVariableDto implements MachineFanucVariable {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty() @IsBoolean() x06_7_frt_dr_closed!: boolean;
  @ApiProperty() @IsBoolean() x01_2_start_cycle!: boolean;
  @ApiProperty() @IsBoolean() y03_2_stack_inCycle!: boolean;
  @ApiProperty({ example: uuidExample }) @IsUUID('loose') machine_id!: string;
}
export class CreateMachineFanucVariableDto
  extends OmitType(MachineFanucVariableDto, ['id'])
  implements CreateMachineFanucVariable {}
export class UpdateMachineFanucVariableDto
  extends PartialType(OmitType(MachineFanucVariableDto, ['id', 'machine_id']))
  implements UpdateMachineFanucVariable {}

// ---------- Macro / macro log ----------
export class MacroDto implements Macro {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: 10032 }) @IsInt() number!: number;
  @ApiProperty({ example: 'consec_no' }) @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() status!: number | null;
  @ApiProperty({ example: 'int' }) @IsString() @IsNotEmpty() type!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() tab_index!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 'general_data' })
  @IsOptional()
  @IsString()
  used_form!: string | null;
  @ApiProperty({ example: 'L60_GENERAL' }) @IsString() @IsNotEmpty() l60_table!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() extra!: string | null;
}
export class CreateMacroDto extends OmitType(MacroDto, ['id']) implements CreateMacro {}
export class UpdateMacroDto extends PartialType(CreateMacroDto) implements UpdateMacro {}

export class MacroLogDto implements MacroLog {
  @ApiProperty({ readOnly: true, example: uuidExample }) @IsUUID('loose') id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID('loose') machine_cycle_id!: string;
  @ApiProperty({ example: uuidExample }) @IsUUID('loose') macro_id!: string;
  @ApiProperty({ example: 12.5 }) @IsNumber() value!: number;
}
export class CreateMacroLogDto extends OmitType(MacroLogDto, ['id']) implements CreateMacroLog {}
export class UpdateMacroLogDto
  extends PartialType(PickType(MacroLogDto, ['value']))
  implements UpdateMacroLog {}

export class LappingSummaryRowDto implements LappingSummaryRow {
  @ApiProperty() id!: string;
  @ApiProperty() machine_cycle_id!: string;
  @ApiProperty() macro_id!: string;
  @ApiProperty() number!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) status!: number | null;
  @ApiProperty() type!: string;
  @ApiProperty({ nullable: true }) tab_index!: number | null;
  @ApiProperty({ nullable: true }) used_form!: string | null;
  @ApiProperty() l60_table!: string;
  @ApiProperty({ nullable: true }) extra!: string | null;
  @ApiProperty() value!: number;
}
