import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
export class UpdateGatePrintingSettingsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) eastPrinter!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) westPrinter!: string;
}
