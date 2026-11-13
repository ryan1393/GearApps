import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class PrintAgentJobResultDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  claimToken!: string;

  @IsBoolean()
  success!: boolean;

  @IsISO8601({ strict: true })
  submittedAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  printer!: string;

  @ValidateIf((value: PrintAgentJobResultDto) => value.success === false)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  error?: string;
}
