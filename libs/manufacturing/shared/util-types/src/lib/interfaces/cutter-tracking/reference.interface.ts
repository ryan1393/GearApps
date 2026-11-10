import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterReferenceEntity extends IBaseEntity {
  code: string;
  name: string;
  description?: string | null;
  sort_order: number;
  enabled: boolean;
}

export type ICutterReference = ApiEntity<ICutterReferenceEntity>;
export interface ICreateCutterReference {
  code: string;
  name: string;
  description?: string | null;
  sort_order?: number;
  enabled?: boolean;
}
export type IUpdateCutterReference = Partial<ICreateCutterReference>;

export interface ICutterReferenceLink { id: Uuid; code: string; name: string; }
