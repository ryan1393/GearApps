import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterBodyEntity extends IBaseEntity {
  /** Dana S/N; null until the cutter body is etched. */
  dana_serial_number?: string | null;
  /** Manufacturer/MF S/N; required permanent identifier and manual lookup key. */
  mf_serial_number: string | null;
  definition_id?: string | null;
  definition?: import('./cutter-body-definition.interface').ICutterBodyDefinition | null;
  description?: string | null;
  enabled: boolean;
}
export type ICutterBody = ApiEntity<ICutterBodyEntity>;
export interface ICreateCutterBody { dana_serial_number?: string | null; mf_serial_number: string; description?: string | null; enabled?: boolean; }
export type IUpdateCutterBody = Partial<ICreateCutterBody>;
