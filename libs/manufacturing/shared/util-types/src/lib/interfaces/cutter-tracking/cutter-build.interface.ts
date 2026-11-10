import { Uuid } from '../../types';
import { IPartSummaryEntity, IPartTypeEntity } from '../base';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';
import { ICutterBodyEntity } from './cutter-body.interface';
import { ICutterReferenceEntity } from './reference.interface';

export interface ICutterBuildEntity extends IBaseEntity {
  build_number: string;
  build_increment: number;
  cutter_body: ICutterBodyEntity;
  cutter_body_id: Uuid;
  summary: IPartSummaryEntity;
  summary_id: Uuid;
  part_type: IPartTypeEntity;
  part_type_id: Uuid;
  status: ICutterReferenceEntity;
  status_id: Uuid;
  honed: boolean;
  coated: boolean;
  ib_ro?: number | null;
  ob_ro?: number | null;
  comments?: string | null;
  built_by_user_id?: Uuid | null;
  cutter_builder_machine_id?: Uuid | null;
  built_at: Date;
  completed_at?: Date | null;
}
export type ICutterBuild = ApiEntity<ICutterBuildEntity>;
export interface ICreateCutterBuild {
  build_number: string;
  build_increment: number;
  cutter_body_id: Uuid;
  summary_id: Uuid;
  part_type_id: Uuid;
  status_id: Uuid;
  honed?: boolean;
  coated?: boolean;
  ib_ro?: number | null;
  ob_ro?: number | null;
  comments?: string | null;
  built_by_user_id?: Uuid | null;
  cutter_builder_machine_id?: Uuid | null;
  built_at?: Date;
}
export type IUpdateCutterBuild = Partial<ICreateCutterBuild> & { completed_at?: Date | null };
