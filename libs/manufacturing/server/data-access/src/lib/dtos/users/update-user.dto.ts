import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { RoleType } from '@meshforge/manufacturing/shared/util-types';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeNumber?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'An enabled department.' })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  avatar?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: RoleType })
  @IsOptional()
  @IsEnum(RoleType)
  role?: RoleType;
}
