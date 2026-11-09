import { Uuid } from "../../types";
import { IBaseEntity, ApiEntity } from "../base-entity.interface";
import { ILocationEntity } from "./location.interface";
import { ITrayEntity } from "./tray.interface";

export interface ILocationTrayEntity extends IBaseEntity {
  tray: ITrayEntity;
  tray_id: Uuid;
  location: ILocationEntity;
  location_id: Uuid;
  enabled: boolean;
}

/**
 * API representation of a Location.
 */
export type ILocationTray = ApiEntity<ILocationTrayEntity>;

/**
 * Fields accepted when creating a location.
 */
export interface ICreateLocationTray {
  tray_id: Uuid;
  location_id: Uuid;
}
// export type ICreateLocation = Omit<
//   ILocationEntity,
//   keyof IBaseEntity
// >;

export type IUpdateLocationTray = Partial<ICreateLocationTray>;
