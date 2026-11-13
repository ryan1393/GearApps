import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PrintAgentRouteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  route!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  sourceQueue!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  outputPrinter!: string;
}

export class PrintAgentHeartbeatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  agentVersion!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrintAgentRouteDto)
  configuredRoutes!: PrintAgentRouteDto[];

  @IsOptional()
  @IsISO8601({ strict: true })
  lastSuccessfulCaptureAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  lastSuccessfulPrintAt?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  lastError?: string;
}

