import {
  IsByteLength,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsStrongPassword,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleType } from '@meshforge/manufacturing/shared/util-types';

export class AdminCreateUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'At least 8 characters with uppercase, number, and symbol.',
  })
  @IsStrongPassword({
    minLength: 8,
    minNumbers: 1,
    minUppercase: 1,
    minSymbols: 1,
  })
  @MaxLength(128)
  @IsByteLength(0, 72, { message: 'Password must be at most 72 UTF-8 bytes' })
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string | null;

  @ApiProperty({ enum: RoleType, default: RoleType.USER })
  @IsEnum(RoleType)
  role!: RoleType;

  @ApiProperty({
    format: 'uuid',
    description: 'Department used for application edit permissions.',
  })
  @IsUUID()
  departmentId!: string;
}
