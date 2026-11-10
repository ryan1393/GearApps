import { Uuid } from '../../types';
import { IUserEntity } from '../user.interface';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';
import { ICutterBuildEntity } from './cutter-build.interface';
import { ICutterReferenceEntity } from './reference.interface';

export interface ICutterEventEntity extends IBaseEntity {
  cutter_build: ICutterBuildEntity;
  cutter_build_id: Uuid;
  event_type: ICutterReferenceEntity;
  event_type_id: Uuid;
  piece_count: number;
  machine_number?: string | null;
  part_number?: string | null;
  user?: IUserEntity | null;
  user_id?: Uuid | null;
  check_result_id?: Uuid | null;
  pull_reason_id?: Uuid | null;
  occurred_at: Date;
  comments?: string | null;
}
export type ICutterEvent = ApiEntity<ICutterEventEntity>;
export interface ICreateCutterEvent {
  cutter_build_id: Uuid;
  event_type_id: Uuid;
  piece_count?: number;
  machine_number?: string | null;
  part_number?: string | null;
  user_id?: Uuid | null;
  check_result_id?: Uuid | null;
  pull_reason_id?: Uuid | null;
  occurred_at?: Date;
  comments?: string | null;
}
export type IUpdateCutterEvent = Partial<ICreateCutterEvent>;
