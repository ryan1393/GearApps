import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class DockPrintResultDto {
  @IsString()
  @IsIn(['PRINTED', 'FAILED'])
  status!: 'PRINTED' | 'FAILED';

  @ValidateIf((value: DockPrintResultDto) => value.status === 'FAILED')
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  error?: string;
}
