import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterBuildLocationEntity extends IBaseEntity {
  cutter_build_id: Uuid;
  location_id: Uuid;
  placed_at: Date;
  removed_at?: Date | null;
  enabled: boolean;
}

export type ICutterBuildLocation = ApiEntity<ICutterBuildLocationEntity>;
