import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';
import { IModelEntity } from './model.interface';

export interface IPartSummaryEntity extends IBaseEntity {
  number: string;
  revision: string;
  model_id: Uuid | null;
  model?: IModelEntity | null;
  hos: string | null;
  active: boolean;
  enabled: boolean;
}

export type IPartSummary = ApiEntity<IPartSummaryEntity>;

export type ICreatePartSummary = Omit<IPartSummaryEntity, keyof IBaseEntity>;
export type IUpdatePartSummary = Partial<ICreatePartSummary>;
