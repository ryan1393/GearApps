import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';
import { ICutterEventEntity } from './cutter-event.interface';
export interface ICutterFrequencyCheckEntity extends IBaseEntity {
  event: ICutterEventEntity; event_id: Uuid; pass_fail?: boolean | null;
  s_e_square?: number | null; s_e_after?: number | null; s_e_result?: number | null;
  total_fr?: number | null; tooth_thickness?: number | null; flank1_pa?: number | null;
  flank1_sa?: number | null; flank2_pa?: number | null; flank2_sa?: number | null;
  size_check?: number | null; comments?: string | null;
}
export type ICutterFrequencyCheck = ApiEntity<ICutterFrequencyCheckEntity>;
