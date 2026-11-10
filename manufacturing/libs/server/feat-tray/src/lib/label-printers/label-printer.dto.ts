import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

/** What a printer is loaded with. Tags and cutter cards are different stock, so each has its own default. */
export const LABEL_TYPES = ['ASSET_TAG', 'CUTTER_CARD'] as const;
export type LabelType = (typeof LABEL_TYPES)[number];

/** The language the printer speaks: Intermec IPL or Zebra ZPL. Sending the wrong one prints nothing. */
export const LABEL_LANGUAGES = ['IPL', 'ZPL'] as const;
export type LabelLanguage = (typeof LABEL_LANGUAGES)[number];

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
