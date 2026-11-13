import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadPackingSlipDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  actor?: string;
}
