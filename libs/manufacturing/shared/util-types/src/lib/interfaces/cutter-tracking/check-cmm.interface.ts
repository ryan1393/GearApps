import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';
import { ICutterEventEntity } from './cutter-event.interface';
export interface ICutterCmmCheckEntity extends IBaseEntity {
  event: ICutterEventEntity; event_id: Uuid; pass_fail?: boolean | null;
  flank_1_pa?: number | null; flank_1_sa?: number | null; flank_1_fp?: number | null; flank_1_fp_small?: number | null; flank_1_fu?: number | null; flank_1_frs?: number | null; flank_1_warp?: number | null;
  flank_1_toe_root?: number | null; flank_1_toe_top?: number | null; flank_1_heel_root?: number | null; flank_1_heel_top?: number | null;
  flank_2_pa?: number | null; flank_2_sa?: number | null; flank_2_fp?: number | null; flank_2_fp_small?: number | null; flank_2_fu?: number | null; flank_2_frs?: number | null; flank_2_warp?: number | null;
  flank_2_toe_root?: number | null; flank_2_toe_top?: number | null; flank_2_heel_root?: number | null; flank_2_heel_top?: number | null;
  tooth_thickness?: number | null; total_fr?: number | null; comments?: string | null;
  sum_error_squared?: number | null; sum_error_after?: number | null; result?: number | null;
}
export type ICutterCmmCheck = ApiEntity<ICutterCmmCheckEntity>;
