import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface IPartTypeEntity extends IBaseEntity {
  code: string;
  name: string;
  description?: string | null;
  sort_order: number;
  enabled: boolean;
}

export type IPartType = ApiEntity<IPartTypeEntity>;
