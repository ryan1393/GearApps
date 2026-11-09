import { Uuid } from "../../types";
import { IBaseEntity, ApiEntity } from "../base-entity.interface";
import { IBlade, IBladeEntity } from "./blade.interface";
import { ITray, ITrayEntity } from "./tray.interface";

export interface IBladeTrayEntity extends IBaseEntity {
  tray: ITrayEntity;
  tray_id: Uuid;
  blade: IBladeEntity;
  blade_id: Uuid;
  enabled: boolean;
}

/**
 * API representation of a Blade.
 */
export type IBladeTray = ApiEntity<IBladeTrayEntity>;

/**
 * Fields accepted when creating a blade.
 */
export interface ICreateBladeTray {
  tray_id: Uuid;
  blade_id: Uuid;
}
// export type ICreateBlade = Omit<
//   IBladeEntity,
//   keyof IBaseEntity
// >;

export type IUpdateBladeTray = Partial<ICreateBladeTray>;
