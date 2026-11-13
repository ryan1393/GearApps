import { IsBoolean } from 'class-validator';

export class SetDockActiveDto {
  @IsBoolean()
  active!: boolean;
}
