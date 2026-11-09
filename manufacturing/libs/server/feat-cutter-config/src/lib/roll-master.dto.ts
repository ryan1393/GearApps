import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRollMasterDto {
  @IsUUID()
  part_id!: string;

  /** Legacy alias retained for older clients; maps to minimum_quantity. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  required_count?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  current_quantity?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  minimum_quantity?: number;

  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() notes?: string | null;
}

export class UpdateRollMasterDto {
  @IsOptional() @IsUUID() part_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) required_count?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) current_quantity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minimum_quantity?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() notes?: string | null;
}
