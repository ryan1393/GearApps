import { IsInt, Max, Min } from 'class-validator';

export class UpdateDockAgingSettingsDto {
  @IsInt()
  @Min(1)
  @Max(10080)
  warningMinutes!: number;

  @IsInt()
  @Min(2)
  @Max(10080)
  criticalMinutes!: number;
}
