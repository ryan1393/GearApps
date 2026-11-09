import { Uuid } from "../../types";
import { IDepartmentEntity } from "../base";
import { IBaseEntity, ApiEntity } from "../base-entity.interface";

export interface ITocEntity extends IBaseEntity {
  name: string;
  description: string;
  enabled: boolean;
}

/**
 * API representation of a Toc.
 */
export type IToc = ApiEntity<ITocEntity>;

/**
 * Fields accepted when creating a blade.
 */
export interface ICreateToc {
  name: string;
  description: string;
  enabled: boolean;
}
// export type ICreateToc = Omit<
//   ITocEntity,
//   keyof IBaseEntity
// >;

export type IUpdateToc = Partial<ICreateToc>;
