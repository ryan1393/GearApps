import { Uuid } from '../../types';
import { IPartSummaryEntity, IPartTypeEntity } from '../base';
import { ITrayStageEntity } from './tray-stage.interface';
import { IBaseEntity, ApiEntity } from '../base-entity.interface';

export interface ITrayEntity extends IBaseEntity {
  serial_number: string;
  blade_count: number;
  summary_id?: Uuid | null;
  summary?: IPartSummaryEntity | null;
  part_type_id?: Uuid | null;
  part_type?: IPartTypeEntity | null;
  grinding_completed_at?: Date | null;
  required_blade_count?: number | null;
  current_stage_id?: Uuid | null;
  current_stage?: ITrayStageEntity | null;
  enabled: boolean;
}

export type ITray = ApiEntity<ITrayEntity>;

export interface ICreateTray {
  serial_number: string;
  blade_count?: number;
  enabled?: boolean;
}

export interface IUpdateTray {
  serial_number?: string;
  enabled?: boolean;
}
