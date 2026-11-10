import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterCheckResultEntity extends IBaseEntity {
  code: string;
  name: string;
  description?: string | null;
  sort_order: number;
  enabled: boolean;
}

export type ICutterCheckResult = ApiEntity<ICutterCheckResultEntity>;
