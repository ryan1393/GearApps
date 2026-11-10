import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface IMachineEntity extends IBaseEntity {
  machine_number: string;
  department_id: Uuid;
  cell: number | null;
  active: boolean;
  description?: string | null;
  machine_type: 'PRODUCTION' | 'CUTTER_BUILDER' | string;
  enabled: boolean;
}

export type IMachine = ApiEntity<IMachineEntity>;
