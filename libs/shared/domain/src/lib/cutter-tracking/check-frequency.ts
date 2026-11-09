import { BaseEntity } from '../common/entity';
import { CutterLog } from './log';

/** Frequency (in-process) check. `s_e_sqaure` column name is kept for DB compatibility. */
export interface CheckFrequency extends BaseEntity {
  log_id: string;
  log?: CutterLog;
  pass_fail: boolean;
  s_e_sqaure: number | null;
  s_e_after: number | null;
  total_fr: number | null;
  tooth_thickness: number | null;
  flank1_pa: number | null;
  flank1_sa: number | null;
  flank2_pa: number | null;
  flank2_sa: number | null;
  size_check: number | null;
  comment: string | null;
}
export type CreateCheckFrequency = Omit<CheckFrequency, 'id' | 'log'>;
export type UpdateCheckFrequency = Partial<CreateCheckFrequency>;
