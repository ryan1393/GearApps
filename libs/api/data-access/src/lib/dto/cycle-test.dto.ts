import { IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArgonautTestInput, CycleTestInput } from '@meshforge/shared/domain';
export class CreateCycleTestDto implements CycleTestInput {
  @ApiProperty() @IsUUID('loose') machine_id!: string;
  @ApiProperty() @IsUUID('loose') gearset_id!: string;
  @ApiProperty({ maxLength: 160 }) @IsString() @Matches(/\S/) @MaxLength(160) serial_number!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) @IsObject() values!: Record<string, number>;
}
export class SendArgonautTestDto implements ArgonautTestInput {
  @ApiProperty() @IsUUID('loose') machine_id!: string;
  @ApiProperty() @IsUUID('loose') gearset_id!: string;
  @ApiProperty({ maxLength: 160 }) @IsString() @Matches(/\S/) @MaxLength(160) serial_number!: string;
  @ApiProperty({ description: "Sent as Argonaut's sequence (a real cycle sends its consec)", minimum: 0 })
  @IsInt() @Min(0) @Max(2147483647) sequence!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' }, description: 'Macro number to value; missing macros are sent as 0' })
  @IsObject() values!: Record<string, number>;
  @ApiPropertyOptional({ description: "Argonaut trigger-transaction URL; empty uses the machine's saved address" })
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @ApiPropertyOptional({ description: "Argonaut locationId; empty uses the machine's saved location" })
  @IsOptional() @IsString() @MaxLength(200) location_id?: string;
}
