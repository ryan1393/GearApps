import { IsOptional, IsString, MaxLength } from 'class-validator';

export class WorkflowActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  actor?: string;

  /** Server-issued PDF preview receipt; never a client-supplied boolean. */
  @IsOptional()
  @IsString()
  @MaxLength(640)
  printProof?: string;
}
