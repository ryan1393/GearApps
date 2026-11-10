import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export class EnvironmentSettingChangeDto {
  @ApiProperty({ example: 'SCANNER_TIMEOUT_MS' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,63}$/, { message: 'key must be a setting name such as SCANNER_TIMEOUT_MS.' })
  key!: string;

  @ApiProperty({ nullable: true, type: String, description: 'The new value, or null to go back to the server environment value.' })
  @ValidateIf((change: EnvironmentSettingChangeDto) => change.value !== null)
  @IsString()
  @MaxLength(20000)
  value!: string | null;
}

export class SaveEnvironmentSettingsDto {
  @ApiProperty({ type: [EnvironmentSettingChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EnvironmentSettingChangeDto)
  changes!: EnvironmentSettingChangeDto[];
}
