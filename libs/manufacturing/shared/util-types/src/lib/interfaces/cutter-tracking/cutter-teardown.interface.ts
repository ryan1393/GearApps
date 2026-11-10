import { Uuid } from '../../types';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterTeardownEntity extends IBaseEntity {
  cutter_build_id: Uuid;
  tray_id: Uuid;
  original_blade_count: number;
  returned_blade_count: number;
  scrapped_blade_count: number;
  torn_down_by_user_id?: Uuid | null;
  torn_down_at: Date;
  comments?: string | null;
}

export type ICutterTeardown = ApiEntity<ICutterTeardownEntity>;

export interface ICreateCutterTeardown {
  cutter_build_id: Uuid;
  tray_id: Uuid;
  original_blade_count: number;
  returned_blade_count: number;
  scrapped_blade_count: number;
  torn_down_by_user_id?: Uuid | null;
  torn_down_at?: Date;
  comments?: string | null;
}

export interface ICutterTeardownResult {
  teardown_id: Uuid;
  build_number: string;
  cutter_body_serial_number: string;
  teardown_tray_serial_number: string;
  shelf_location_serial_number: string | null;
  original_blade_count: number;
  returned_blade_count: number;
  scrapped_blade_count: number;
  build_closed: boolean;
  tray_waiting_for_grinding: boolean;
  tray_available_for_use: boolean;
  torn_down_at: Date;
}
