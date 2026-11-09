import {
  CreateUser,
  LoginPayload,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PublicUser,
  TokenResponse,
  UpdateUser,
} from '@gearapps/shared/domain';
import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class LoginRequestDto implements LoginPayload {
  @ApiProperty({ example: 'operator@example.com' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 254)
  email!: string;

  @ApiProperty({ example: 'Sup3r$ecret' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class TokenResponseDto implements TokenResponse {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  access_token!: string;
}

export class PublicUserDto implements PublicUser {
  @ApiProperty({ readOnly: true }) @IsUUID() id!: string;
  @ApiProperty({ example: 'operator@example.com' }) @IsEmail() email!: string;
  @ApiProperty({ example: 'Ryan' }) @IsString() @IsOptional() fname!: string;
  @ApiProperty({ example: 'Smith' }) @IsString() @IsOptional() lname!: string;
}

export class CreateUserDto extends OmitType(PublicUserDto, ['id']) implements CreateUser {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) implements UpdateUser {}
