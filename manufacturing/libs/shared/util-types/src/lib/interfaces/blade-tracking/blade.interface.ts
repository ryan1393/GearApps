import { BladeStatus } from '../../enums';
import { Uuid } from '../../types';
import { IPartSummaryEntity } from '../base';
import { IPartTypeEntity } from '../base/part-type.interface';
import { IBaseEntity, ApiEntity } from '../base-entity.interface';

export interface IBladeEntity extends IBaseEntity {
  summary_id: Uuid;
  summary?: IPartSummaryEntity;
  serial_number: string;
  part_type_id: Uuid;
  part_type?: IPartTypeEntity;
  status: BladeStatus;
  service_cycle: number;
  enabled: boolean;
}

export type IBlade = ApiEntity<IBladeEntity>;

export interface ICreateBlade {
  summary_id: Uuid;
  serial_number: string;
  part_type_id: Uuid;
  status?: BladeStatus;
  service_cycle?: number;
  enabled?: boolean;
}

export type IUpdateBlade = Partial<ICreateBlade>;
