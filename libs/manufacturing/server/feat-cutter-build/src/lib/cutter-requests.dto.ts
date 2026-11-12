import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CUTTER_REQUEST_STATUSES, CutterRequestStatus } from '@meshforge/shared/domain';

export { CUTTER_REQUEST_STATUSES, CutterRequestStatus } from '@meshforge/shared/domain';

export class CreateCutterRequestDto {
  @IsUUID() summary_id!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsIn(['RING', 'PINION']) part_type_code!: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class UpdateCutterRequestStatusDto {
  @IsIn(CUTTER_REQUEST_STATUSES) status!: CutterRequestStatus;
}
