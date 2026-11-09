import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterPullReasonEntity extends IBaseEntity {
  code: string;
  name: string;
  description?: string | null;
  requires_teardown: boolean;
  returns_to_shelf: boolean;
  sort_order: number;
  enabled: boolean;
}

export type ICutterPullReason = ApiEntity<ICutterPullReasonEntity>;
