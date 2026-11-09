import { ApiEntity, IBaseEntity } from '../base-entity.interface';

export interface ICutterBodyDefinitionEntity extends IBaseEntity {
  definition_code: string;
  cutter_head_code: string;
  supplier_code: string;
  supplier_name: string;
  hand_code: string;
  hand_name: string;
  blade_family_code: string;
  blade_family_name: string;
  size_code: string;
  size_description?: string | null;
  enabled: boolean;
}

export type ICutterBodyDefinition = ApiEntity<ICutterBodyDefinitionEntity>;
