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

/** Make every bin of one Cuttergrind shelf in one go: CGDR, shelf A, layers 1 and 2, 4 bins. */
export interface IBulkCreateShelfLocations {
  /** CGDR, CGDP, CGFR, CGFP, CGRR or CGRP. */
  prefix: string;
  /** Shelf letter, A to Z. */
  shelf: string;
  /** Layer numbers, 1 to 9. */
  layers: number[];
  /** Bins per layer, 1 to 26: bins A onward. */
  bins: number;
}

export interface IBulkShelfLocationResult {
  id: Uuid;
  serial_number: string;
  /** created: made now. existing: the barcode was already there and was left as it is. */
  state: 'created' | 'existing';
  enabled: boolean;
}

export interface IBulkShelfLocationsResult {
  created: number;
  existing: number;
  locations: IBulkShelfLocationResult[];
}
