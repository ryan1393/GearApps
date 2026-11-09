import { BaseEntity } from '../common/entity';
import { CutterLog } from './log';

/** CMM measurement check. Column names mirror the measurement report. */
export interface CheckCmm extends BaseEntity {
  log_id: string;
  log?: CutterLog;
  pass_fail: boolean;
  flank_1_Pa: number;
  flank_1_Sa: number;
  flank_1_Fp: number;
  flank_1__fp: number;
  flank_1_fu: number;
  flank_1_Frs: number;
  flank_1_warp: number;
  flank_1_toe_root: number;
  flank_1_toe_top: number;
  flank_1_heel_root: number;
  flank_1_heel_top: number;
  flank_2_Pa: number;
  flank_2_Sa: number;
  flank_2_Fp: number;
  flank_2__fp: number;
  flank_2_fu: number;
  flank_2_Frs: number;
  flank_2_warp: number;
  flank_2_toe_root: number;
  flank_2_toe_top: number;
  flank_2_heel_root: number;
  flank_2_heel_top: number;
  sum_Error_squared: number;
  sum_Error_after: number;
  result: number;
  comment: string | null;
}
export type CreateCheckCmm = Omit<CheckCmm, 'id' | 'log'>;
export type UpdateCheckCmm = Partial<CreateCheckCmm>;
