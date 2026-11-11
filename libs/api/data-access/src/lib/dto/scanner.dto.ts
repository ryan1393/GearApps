import { ApiErrorResponse, ScannerCommand } from '@meshforge/shared/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ScannerCommandDto implements ScannerCommand {
  @ApiProperty({ example: 'OUTON,1', description: 'Raw scanner op code' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9,_-]{1,32}$/, { message: 'command must be an upper-case scanner op code' })
  data!: string;
}

export class ErrorResponseDto implements ApiErrorResponse {
  @ApiProperty({ example: 'Validation failed' }) message!: string;
  @ApiProperty({ example: 'Bad Request' }) error!: string;
  @ApiPropertyOptional({ example: 400 }) statusCode?: number;
}
