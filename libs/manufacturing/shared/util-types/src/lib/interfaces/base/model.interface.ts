import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface IModelEntity extends IBaseEntity {
  model_number: string | null;
  model_type: string | null;
  active: boolean;
  enabled: boolean;
}

export type IModel = ApiEntity<IModelEntity>;
