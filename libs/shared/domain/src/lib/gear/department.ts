import { BaseEntity } from '../common/entity';

export interface Department extends BaseEntity {
  number: number;
  description: string;
}
export type CreateDepartment = Pick<Department, 'number' | 'description'>;
export type UpdateDepartment = Partial<Omit<Department, 'id'>>;
