import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface IPartEntity extends IBaseEntity {
  part_number: string;
  summary_id: Uuid;
  part_type_id: Uuid;
  teeth: number | null;
  active: boolean;
  enabled: boolean;
}

export type IPart = ApiEntity<IPartEntity>;

export interface ICreatePart {
  part_number: string;
  summary_id: Uuid;
  part_type_id: Uuid;
  teeth?: number | null;
  active?: boolean;
  enabled?: boolean;
}

export type IUpdatePart = Partial<ICreatePart>;
