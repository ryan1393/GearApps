import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ITrayGrindingRunEntity extends IBaseEntity {
  tray_id: Uuid;
  grinding_machine_id?: Uuid | null;
  grinding_machine_number?: string | null;
  summary_id: Uuid;
  part_type_id: Uuid;
  starting_blade_count: number;
  returned_blade_count: number;
  scrapped_blade_count: number;
  required_blade_count: number;
  completed_by_user_id?: Uuid | null;
  completed_at: Date;
}

export type ITrayGrindingRun = ApiEntity<ITrayGrindingRunEntity>;
