import { IBaseEntity, ApiEntity } from '../base-entity.interface';

export interface ILocationEntity extends IBaseEntity {
  serial_number: string;
  number: string
  description: string | null;
  department: string | null;
  location_type: string;
  enabled: boolean;
}

/**
 * API representation of a Location.
 */
export type ILocation = ApiEntity<ILocationEntity>;

/**
 * Fields accepted when creating a location.
 */
export type ICreateLocation = Omit<
  ILocationEntity,
  keyof IBaseEntity
>;

export type IUpdateLocation = Partial<ICreateLocation>;
