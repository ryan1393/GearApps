import { Uuid } from "../../types";
import { IBaseEntity, ApiEntity } from "../base-entity.interface";
import { IContainerEntity } from "./container.interface";
import { ITrayEntity } from "./tray.interface";

export interface IContainerTrayEntity extends IBaseEntity {
  tray: ITrayEntity;
  tray_id: Uuid;
  container: IContainerEntity;
  container_id: Uuid;
  enabled: boolean;
}

/**
 * API representation of a Container.
 */
export type IContainerTray = ApiEntity<IContainerTrayEntity>;

/**
 * Fields accepted when creating a container.
 */
export interface ICreateContainerTray {
  tray_id: Uuid;
  container_id: Uuid;
}
// export type ICreateContainer = Omit<
//   IContainerEntity,
//   keyof IBaseEntity
// >;

export type IUpdateContainerTray = Partial<ICreateContainerTray>;
