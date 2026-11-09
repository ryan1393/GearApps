import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterMachineRunEntity extends IBaseEntity {
  cutter_build_id: Uuid;
  machine_id: Uuid;
  part_id: Uuid;
  machine_number: string;
  shift: string | null;
  installed_at: Date;
  removed_at?: Date | null;
  current_piece_count: number;
  last_check_piece_count: number;
  installed_by_user_id?: Uuid | null;
  removed_by_user_id?: Uuid | null;
  enabled: boolean;
}

export type ICutterMachineRun = ApiEntity<ICutterMachineRunEntity>;
