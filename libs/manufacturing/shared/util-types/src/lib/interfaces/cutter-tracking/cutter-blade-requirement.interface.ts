import { Uuid } from '../../types';
import { IPartSummaryEntity, IPartTypeEntity } from '../base';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterBladeRequirementEntity extends IBaseEntity {
  summary_id: Uuid;
  part_type_id: Uuid;
  /** Matched inner/outer blade sets (one set = 2 blades); Summary-based. */
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
  /** Dana S/N (or MF S/N of an unetched body); adds body compatibility to the answer. */
  cutter_body_identifier?: string;
}

export interface IValidateCutterTrayResult {
  valid: boolean;
  tray_id: Uuid;
  tray_serial_number: string;
  grinding_complete: boolean;
  /** Matched inner/outer blade sets. */
  required_blade_count: number;
  /** The same requirement in total individual blades. */
  required_total_blades?: number | null;
  /** The Summary's configured Body Size Rule code, or null when not configured. */
  summary_body_rule?: string | null;
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
  /** Present only when cutter_body_identifier was sent. */
  cutter_body_id?: Uuid | null;
  /** Type compatibility: the shared body rule check for this Summary + Part Type. */
  body_compatible?: boolean;
  body_rule?: string | null;
  body_reason?: string | null;
  /** Physical availability (no open build), kept apart from type compatibility. */
  body_available?: boolean;
  body_availability_reason?: string | null;
  reason?: string;
}

export interface ISummaryBodyRuleRequirement {
  id: Uuid;
  part_type_code: string;
  /** Matched inner/outer blade sets. */
  required_blade_count: number;
  enabled: boolean;
}

/** A Summary's Body Size Rule and its Summary-based required quantity. */
export interface ISummaryBodyRuleRow {
  summary_id: Uuid;
  summary_number: string;
  summary_revision: string | null;
  summary_enabled: boolean;
  model_number: string | null;
  configured_body_rule: string | null;
  status: 'CONFIGURED' | 'DERIVED' | 'UNRESOLVED' | 'CONFLICT' | 'NO_REQUIREMENT';
  effective_body_rule: string | null;
  effective_body_rule_label: string | null;
  required_blade_sets: number | null;
  required_total_blades: number | null;
  detail: string;
  /** Codes of the enabled body definitions this Summary's blades may be loaded into (empty when unresolved). */
  permitted_body_definitions?: string[];
  requirements: ISummaryBodyRuleRequirement[];
  open_trays_with_other_quantity?: number;
}
