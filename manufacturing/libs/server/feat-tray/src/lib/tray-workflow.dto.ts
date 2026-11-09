import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min, IsString, Length, Matches, IsOptional } from 'class-validator';

export class CompleteTrayGrindingDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  summary_id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  part_type_id!: string;

  @ApiProperty({
    minimum: 0,
    description:
      'Blades scrapped during grinding before usable blades are returned to the tray.',
  })
  @IsInt()
  @Min(0)
  scrapped_blade_count!: number;

  @ApiProperty({ required: false, example: 'CGRR-001', description: 'Actual numbered rough shelf; required for a complete tray, omitted for a short tray.' })
  @IsOptional()
  @IsString()
  @Length(8, 8)
  @Matches(/^(CGRR|CGRP)-\d{3}$/i)
  rough_shelf_serial_number?: string;
}

export class EmptyBodyIdentifierDto {
  @ApiProperty() @IsString() @Length(1, 120) @Matches(/\S/)
  body_identifier!: string;
}
export class PlaceEmptyBodyDto extends EmptyBodyIdentifierDto {
  @ApiProperty() @IsString() @Length(1, 120) @Matches(/\S/)
  shelf_serial!: string;
}

export class RemoveEmptyBodyDto extends EmptyBodyIdentifierDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() placement_id!: string;
}

export class InventoryAvailabilityQueryDto {
  @IsUUID() summaryId!: string;
  @IsOptional() @IsUUID() partTypeId?: string;
}
