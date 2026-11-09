// base-entity.interface.ts
import { Uuid } from '../types';

export interface IBaseEntity {
  id: Uuid;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  createdBy: Uuid;
  updatedBy: Uuid;
  deletedBy?: Uuid | null;
}

export type ApiEntity<T extends IBaseEntity> = Omit<
  T,
  'createdAt' | 'updatedAt' | 'deletedAt' | 'createdBy' | 'updatedBy' | 'deletedBy'
> & {
  createdAt: string;
  updatedAt: string;
  createdBy: Uuid;
  updatedBy: Uuid;
};
