import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCollectorTokenDto {
  @ApiProperty({ example: 'Lapper Read – Plant 1', description: 'Where the token is used' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}
