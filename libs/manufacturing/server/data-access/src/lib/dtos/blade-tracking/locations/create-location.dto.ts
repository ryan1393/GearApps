import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { ICreateLocation } from '@meshforge/manufacturing/shared/util-types';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class CreateLocationDto implements ICreateLocation {
  @ApiProperty({
    type: String,
    description: 'Unique barcode / scanner value. Summary shelf tags use GSR-<summary>/GSP-<summary> for Green Shed. Cuttergrind shelves are CGRR-###/CGRP-### (rough), CGDR-A1A/CGDP-A1A (dull) and CGFR-A1A/CGFP-A1A (finished), where A1A is shelf letter, layer number, bin letter.',
  })
  @IsString()
  serial_number!: string;

  @ApiProperty({
    type: String,
    description: 'Location number. For summary shelf tags this is automatically set to the summary number.',
  })
  @IsString()
  number!: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsOptional()
  @IsString()
  description!: string | null;

  @ApiPropertyOptional({ type: String, description: 'Department or area. Automatically derived for GSR-/GSP- summary shelf tags and CGRR-/CGRP-/CGDR-/CGDP-/CGFR-/CGFP- Cuttergrind shelves.' })
  @IsOptional()
  @IsString()
  department!: string | null;

  @ApiPropertyOptional({ type: String, default: 'INTERNAL', description: 'Location type such as SHELF or WORKCENTER. GSR-/GSP-/CGDR-/CGDP-/CGFR-/CGFP- tags are always SHELF.' })
  @IsOptional()
  @IsString()
  location_type!: string;

  @ApiProperty({
    type: Boolean,
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The Summary kept at this location, printed on its summary tag. Null clears it. Set automatically for GSR-/GSP- summary shelf tags.',
  })
  @IsOptional()
  @IsUUID()
  summary_id?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The part type kept at this location, printed on its summary tag. Null clears it. Set automatically for GSR-/GSP- summary shelf tags.',
  })
  @IsOptional()
  @IsUUID()
  part_type_id?: string | null;
}
