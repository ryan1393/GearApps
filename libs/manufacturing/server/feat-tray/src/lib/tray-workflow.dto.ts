import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min, IsString, Length, Matches, IsOptional } from 'class-validator';

export class StartTrayGrindingDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  grinding_machine_id!: string;
}

export class CompleteTrayGrindingDto extends StartTrayGrindingDto {
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

  @ApiProperty({ required: false, example: 'CGRR-A1A', description: 'Actual rough shelf bin (shelf letter, layer number, bin letter); required for a complete tray, omitted for a short tray.' })
  @IsOptional()
  @IsString()
  @Length(8, 8)
  @Matches(/^(CGRR|CGRP)-[A-Z][1-9][A-Z]$/i)
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
