import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  actor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentType?: string;
}
