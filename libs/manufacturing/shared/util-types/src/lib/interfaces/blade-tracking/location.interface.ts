import { Uuid } from '../../types';
import { IPartSummaryEntity, IPartTypeEntity } from '../base';
import { IBaseEntity, ApiEntity } from '../base-entity.interface';

export interface ILocationEntity extends IBaseEntity {
  serial_number: string;
  number: string
  description: string | null;
  department: string | null;
  location_type: string;
  enabled: boolean;
  /** The Summary kept at this location, printed on its summary tag. Optional. */
  summary_id?: Uuid | null;
  summary?: IPartSummaryEntity | null;
  /** The part type kept at this location, printed on its summary tag. Optional. */
  part_type_id?: Uuid | null;
  part_type?: IPartTypeEntity | null;
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
