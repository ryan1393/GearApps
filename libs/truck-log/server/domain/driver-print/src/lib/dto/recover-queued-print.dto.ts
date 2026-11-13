import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class RecoverQueuedPrintDto {
  @IsIn(['DOCK_ASSIGNMENT', 'RXO_DOCUMENT'])
  itemType!: 'DOCK_ASSIGNMENT' | 'RXO_DOCUMENT';
  @IsIn(['CANCEL', 'REPLACE'])
  action!: 'CANCEL' | 'REPLACE';
  @IsString()
  @Length(1, 1000)
  reason!: string;
  @IsOptional()
  @IsIn(['EAST', 'WEST'])
  gate?: 'EAST' | 'WEST';
}
