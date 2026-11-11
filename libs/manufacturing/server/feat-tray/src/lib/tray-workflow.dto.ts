import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min, IsString, Length, Matches, IsOptional, IsIn } from 'class-validator';

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

  @ApiProperty({
    required: false,
    example: 'CGRR-A1A',
    description: 'Where a complete tray or its container goes: blank or COATER-STAGING for the coater staging area (the default), or a rough shelf bin such as CGRR-A1A. Omitted for a short tray.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^((CGRR|CGRP)-[A-Z][1-9][A-Z]|COATER-STAGING)$/i)
  rough_shelf_serial_number?: string;

  @ApiProperty({
    required: false,
    enum: ['CONTAINER', 'TRAY'],
    description: 'CONTAINER moves the complete set into an empty coater container and empties the tray; TRAY leaves the blades in the tray. Defaults to CONTAINER when a container is scanned, otherwise TRAY.',
  })
  @IsOptional()
  @IsIn(['CONTAINER', 'TRAY'])
  destination?: 'CONTAINER' | 'TRAY';

  @ApiProperty({ required: false, example: 'C0001', description: 'The empty coater container a complete set goes into (destination CONTAINER).' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  container_serial_number?: string;
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
