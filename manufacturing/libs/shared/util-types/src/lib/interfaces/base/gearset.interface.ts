import { Uuid } from "../../types";
import { IDepartmentEntity, IPartEntity, IPartSummary, IPartSummaryEntity } from "../base";
import { IBaseEntity, ApiEntity } from "../base-entity.interface";

export interface IGearsetEntity extends IBaseEntity {
  number: string;
  rev: string;
  ratio: number;
  pinion: IPartEntity;
  pinion_id: Uuid;
  ring: IPartEntity;
  ring_id: Uuid;
  enabled: boolean;
}

/**
 * API representation of a Gearset.
 */
export type IGearset = ApiEntity<IGearsetEntity>;

/**
 * Fields accepted when creating a blade.
 */
export interface ICreateGearset {
  number: string;
  rev: string;
  ratio: number;
  pinion_id: Uuid;
  ring_id: Uuid;
  enabled: boolean;
}
// export type ICreateGearset = Omit<
//   IGearsetEntity,
//   keyof IBaseEntity
// >;

export type IUpdateGearset = Partial<ICreateGearset>;
