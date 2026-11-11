import { IsObject, IsString, IsUUID, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CycleTestInput } from '@meshforge/shared/domain';
export class CreateCycleTestDto implements CycleTestInput {
  @ApiProperty() @IsUUID() machine_id!: string;
  @ApiProperty() @IsUUID() gearset_id!: string;
  @ApiProperty({ maxLength: 160 }) @IsString() @Matches(/\S/) @MaxLength(160) serial_number!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) @IsObject() values!: Record<string, number>;
}
