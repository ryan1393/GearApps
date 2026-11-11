import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, Matches, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import {
  CUTTERGRIND_SHELF_MAX_BINS,
  CUTTERGRIND_SHELF_MAX_LAYER,
  CUTTERGRIND_SHELF_PREFIXES,
  CuttergrindShelfPrefix,
} from '@meshforge/manufacturing/shared/util-constants';
import {
  IBulkCreateShelfLocations,
  IBulkShelfLocationResult,
  IBulkShelfLocationsResult,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';

export class BulkCreateShelfLocationsDto implements IBulkCreateShelfLocations {
  @ApiProperty({ enum: CUTTERGRIND_SHELF_PREFIXES, description: 'CGDR/CGDP dull, CGFR/CGFP finished, CGRR/CGRP rough (R = ring, P = pinion).' })
  @IsIn(CUTTERGRIND_SHELF_PREFIXES)
  prefix!: CuttergrindShelfPrefix;

  @ApiProperty({ type: String, example: 'A', description: 'Shelf letter, A to Z.' })
  @Matches(/^[A-Za-z]$/, { message: 'shelf must be one letter, A to Z' })
  shelf!: string;

  @ApiProperty({ type: [Number], example: [1], description: `Layer numbers, 1 to ${CUTTERGRIND_SHELF_MAX_LAYER}.` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CUTTERGRIND_SHELF_MAX_LAYER)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(CUTTERGRIND_SHELF_MAX_LAYER, { each: true })
  layers!: number[];

  @ApiProperty({ type: Number, example: 6, minimum: 1, maximum: CUTTERGRIND_SHELF_MAX_BINS, description: 'Bins per layer, lettered A onward.' })
  @IsInt()
  @Min(1)
  @Max(CUTTERGRIND_SHELF_MAX_BINS)
  bins!: number;
}

export class BulkShelfLocationResultDto implements IBulkShelfLocationResult {
  @ApiProperty({ type: String, format: 'uuid' }) id!: Uuid;
  @ApiProperty({ type: String, example: 'CGDR-A1A' }) serial_number!: string;
  @ApiProperty({ enum: ['created', 'existing'] }) state!: 'created' | 'existing';
  @ApiProperty({ type: Boolean }) enabled!: boolean;
}

export class BulkShelfLocationsResultDto implements IBulkShelfLocationsResult {
  @ApiProperty({ type: Number }) created!: number;
  @ApiProperty({ type: Number }) existing!: number;
  @ApiProperty({ type: [BulkShelfLocationResultDto] }) locations!: BulkShelfLocationResultDto[];
}
