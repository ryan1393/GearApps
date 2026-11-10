import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

/** What a printer is loaded with. Tags and cutter cards are different stock, so each has its own default. */
export const LABEL_TYPES = ['ASSET_TAG', 'CUTTER_CARD'] as const;
export type LabelType = (typeof LABEL_TYPES)[number];

/** The language the printer speaks: Intermec IPL or Zebra ZPL. Sending the wrong one prints nothing. */
export const LABEL_LANGUAGES = ['IPL', 'ZPL'] as const;
export type LabelLanguage = (typeof LABEL_LANGUAGES)[number];

/** Where a label lands differs a little from printer to printer; this is the most it can be nudged, in dots. */
export const LABEL_ADJUSTMENT_LIMIT = 100;

/** How far to move a label from where the format puts it. 203 dots are one inch. */
export interface LabelAdjustment {
  right: number;
  down: number;
}

/** A DNS name or IPv4 address: no scheme, port, path or spaces. */
const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export class SaveLabelPrinterDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsString()
  @Matches(HOST_PATTERN, { message: 'Enter the printer IP address or network name only, for example 10.16.40.25.' })
  host!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsIn(LABEL_TYPES)
  label_type!: LabelType;

  @IsIn(LABEL_LANGUAGES)
  language!: LabelLanguage;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Moves everything this printer prints right (negative: left), in dots. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-LABEL_ADJUSTMENT_LIMIT)
  @Max(LABEL_ADJUSTMENT_LIMIT)
  offset_right?: number;

  /** Moves everything this printer prints down (negative: up), in dots. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-LABEL_ADJUSTMENT_LIMIT)
  @Max(LABEL_ADJUSTMENT_LIMIT)
  offset_down?: number;
}

export class LabelPrinterChoicesQueryDto {
  @IsIn(LABEL_TYPES)
  label_type!: LabelType;
}

export class PrintToPrinterDto {
  /** The printer chosen on this computer. Omitted: the default printer for that label. */
  @IsOptional()
  @IsUUID()
  printer_id?: string;
}
