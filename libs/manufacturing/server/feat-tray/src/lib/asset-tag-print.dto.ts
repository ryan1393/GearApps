import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const ASSET_TAG_KINDS = ['TRAY', 'CONTAINER', 'LOCATION'] as const;
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
