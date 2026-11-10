import { IBaseEntity, ApiEntity } from '../base-entity.interface';

export interface IContainerEntity extends IBaseEntity {
  serial_number: string;
  enabled: boolean;
}

/**
 * API representation of a Container.
 */
export type IContainer = ApiEntity<IContainerEntity>;

/**
 * Fields accepted when creating a location.
 */
export type ICreateContainer = Omit<
  IContainerEntity,
  keyof IBaseEntity
>;

export type IUpdateContainer = Partial<ICreateContainer>;
