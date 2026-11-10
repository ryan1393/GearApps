import { Uuid } from '../../types';
import { IPartSummaryEntity, IPartTypeEntity } from '../base';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterBladeRequirementEntity extends IBaseEntity {
  summary_id: Uuid;
  part_type_id: Uuid;
  required_blade_count: number;
  enabled: boolean;
  summary?: IPartSummaryEntity;
  part_type?: IPartTypeEntity;
}

export type ICutterBladeRequirement = ApiEntity<ICutterBladeRequirementEntity>;

export interface ICreateCutterBladeRequirement {
  summary_id: Uuid;
  part_type_id: Uuid;
  required_blade_count: number;
  enabled?: boolean;
}

export type IUpdateCutterBladeRequirement = Partial<ICreateCutterBladeRequirement>;

export interface IValidateCutterTrayRequest {
  summary_id: Uuid;
  part_type_id: Uuid;
  tray_serial_number: string;
}

export interface IValidateCutterTrayResult {
  valid: boolean;
  tray_id: Uuid;
  tray_serial_number: string;
  grinding_complete: boolean;
  required_blade_count: number;
  tray_declared_blade_count: number;
  active_blade_count: number;
  requirement_id: Uuid;
  summary_matches: boolean;
  part_type_matches: boolean;
  blade_identity_matches: boolean;
  blades_ready_for_cutter: boolean;
  already_assigned_to_build: boolean;
  still_in_container: boolean;
  tray_stage_ready: boolean;
  reason?: string;
}
