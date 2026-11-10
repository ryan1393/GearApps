import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface IRollMasterEntity extends IBaseEntity {
  part_id: Uuid;
  required_count: number;
  current_quantity: number;
  minimum_quantity: number;
  active: boolean;
  enabled: boolean;
  notes: string | null;
}

export type IRollMaster = ApiEntity<IRollMasterEntity>;

export interface ICreateRollMaster {
  part_id: Uuid;
  required_count?: number;
  current_quantity?: number;
  minimum_quantity?: number;
  active?: boolean;
  enabled?: boolean;
  notes?: string | null;
}

export type IUpdateRollMaster = Partial<ICreateRollMaster>;
