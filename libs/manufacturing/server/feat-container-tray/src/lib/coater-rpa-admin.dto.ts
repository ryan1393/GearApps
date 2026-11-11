import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export class CoaterRpaSettingsDto {
  @IsString() @MinLength(1) @MaxLength(160) coater_display_name!: string;
  @IsInt() @Min(1) @Max(9999998) next_number!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999) unit_price!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999) insurance_unit!: number;
  @IsArray() @ArrayMaxSize(20) @IsEmail({}, { each: true }) recipients_to!: string[];
  @IsArray() @ArrayMaxSize(20) @IsEmail({}, { each: true }) recipients_cc!: string[];
  @IsOptional() @IsString() @MaxLength(80) default_po?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'default_po_expires_on must be a date (YYYY-MM-DD)' })
  default_po_expires_on?: string | null;
  @IsBoolean() default_po_enabled!: boolean;
}

export class CoaterRpaPartKeyDto {
  @IsString() @MinLength(1) @MaxLength(80) summary!: string;
  @IsIn(['RING', 'PINION']) part_type!: 'RING' | 'PINION';
}

export class CoaterRpaPartMapDto extends CoaterRpaPartKeyDto {
  @IsString() @MinLength(1) @MaxLength(80) outer_part!: string;
  @IsString() @MinLength(1) @MaxLength(80) inner_part!: string;
}
