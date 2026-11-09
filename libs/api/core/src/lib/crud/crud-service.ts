import { BaseEntity } from '@gearapps/shared/domain';

/** Application service contract; controllers do not depend on an ORM repository. */
export abstract class CrudService<T extends BaseEntity> {
  abstract findAll(): Promise<T[]>;
  abstract findOne(id: string): Promise<T>;
  abstract create(body: unknown, requestKey?: string): Promise<T>;
  abstract upsert(id: string, body: unknown): Promise<T>;
  abstract update(id: string, body: unknown): Promise<T>;
  abstract remove(id: string): Promise<void>;
}
