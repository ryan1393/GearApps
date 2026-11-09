import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, Equals } from 'class-validator';

export class CreateCoaterShipmentDto {
  @IsUUID() request_id!: string;
  @IsString() @MinLength(1) @MaxLength(120) destination!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class CoaterRevisionDto {
  @IsInt() @Min(1) revision!: number;
}
export class CoaterContainerDto extends CoaterRevisionDto {
  @IsString() @MinLength(1) @MaxLength(80) serial!: string;
}
export class UpdateCoaterShipmentDto extends CoaterRevisionDto {
  @IsString() @MinLength(1) @MaxLength(120) destination!: string;
  @IsString() @MaxLength(1000) notes!: string;
}
export class DispatchCoaterShipmentDto extends CoaterRevisionDto {
  @IsBoolean() @Equals(true) printed_and_checked!: boolean;
}
export class CancelCoaterShipmentDto extends CoaterRevisionDto {
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
