import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface IDepartmentEntity extends IBaseEntity {
  code: string;
  description: string;
  active: boolean;
  enabled: boolean;
}

export type IDepartment = ApiEntity<IDepartmentEntity>;

export type ICreateDepartment = Omit<IDepartmentEntity, keyof IBaseEntity>;
export type IUpdateDepartment = Partial<ICreateDepartment>;
