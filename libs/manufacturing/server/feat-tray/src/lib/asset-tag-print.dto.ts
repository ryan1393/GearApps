import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * LOCATION_SUMMARY is a location's summary tag: its barcode is the Summary and part type kept
 * there, such as 1.955FC-RING, rather than the location's own serial.
 */
export const ASSET_TAG_KINDS = ['TRAY', 'CONTAINER', 'LOCATION', 'LOCATION_SUMMARY'] as const;
export type AssetTagKind = (typeof ASSET_TAG_KINDS)[number];

export class PrintAssetTagDto {
  @IsIn(ASSET_TAG_KINDS)
  kind!: AssetTagKind;

  @IsUUID()
  record_id!: string;

  /** The printer chosen on this computer. Omitted: the default tag printer. */
  @IsOptional()
  @IsUUID()
  printer_id?: string;
}

export class PrintLocationLabelDto {
  @IsUUID()
  record_id!: string;

  /** The card printer chosen on this computer. Omitted: the default 4 x 6.5 card printer. */
  @IsOptional()
  @IsUUID()
  printer_id?: string;
}
