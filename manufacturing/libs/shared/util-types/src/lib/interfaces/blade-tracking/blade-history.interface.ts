import { BladeHistoryEvent, BladeStatus } from '../../enums';
import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';
import { IBladeEntity } from './blade.interface';

export interface IBladeHistoryEntity extends IBaseEntity {
  blade: IBladeEntity;
  blade_id: Uuid;
  event_type: BladeHistoryEvent;
  from_status?: BladeStatus | null;
  to_status?: BladeStatus | null;
  service_cycle: number;
  tray_id?: Uuid | null;
  container_id?: Uuid | null;
  notes?: string | null;
}

export type IBladeHistory = ApiEntity<IBladeHistoryEntity>;
