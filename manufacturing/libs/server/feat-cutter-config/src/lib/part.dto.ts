import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreatePartDto {
  @IsString()
  part_number!: string;

  @IsUUID()
  summary_id!: string;

  @IsUUID()
  part_type_id!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teeth?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdatePartDto {
  @IsOptional()
  @IsString()
  part_number?: string;

  @IsOptional()
  @IsUUID()
  summary_id?: string;

  @IsOptional()
  @IsUUID()
  part_type_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teeth?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
