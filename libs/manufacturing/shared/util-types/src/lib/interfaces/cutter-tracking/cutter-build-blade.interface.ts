import { Uuid } from '../../types';
import { IBladeEntity } from '../blade-tracking';
import { ApiEntity, IBaseEntity } from '../base-entity.interface';
import { ICutterBuildEntity } from './cutter-build.interface';

export interface ICutterBuildBladeEntity extends IBaseEntity {
  cutter_build: ICutterBuildEntity;
  cutter_build_id: Uuid;
  blade: IBladeEntity;
  blade_id: Uuid;
  position?: number | null;
  installed_at: Date;
  removed_at?: Date | null;
  enabled: boolean;
}
export type ICutterBuildBlade = ApiEntity<ICutterBuildBladeEntity>;
export interface ICreateCutterBuildBlade {
  cutter_build_id: Uuid;
  blade_id: Uuid;
  position?: number | null;
  installed_at?: Date;
  enabled?: boolean;
}
export type IUpdateCutterBuildBlade = Partial<ICreateCutterBuildBlade> & { removed_at?: Date | null };
