import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ITrayStageEntity extends IBaseEntity {
  code: string;
  name: string;
  description?: string | null;
  sort_order: number;
  enabled: boolean;
}

export type ITrayStage = ApiEntity<ITrayStageEntity>;
