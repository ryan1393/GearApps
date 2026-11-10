import { Uuid } from '../../types';

export interface ICreateCutterBuilderBuild {
  cutter_body_serial_number: string;
  tray_serial_number: string;
  honed?: boolean;
  coated?: boolean;
  ib_ro?: number | null;
  ob_ro?: number | null;
  comments?: string | null;
  cutter_builder_machine_id?: Uuid;
}

export interface ICutterCardData {
  cutter_build_id: Uuid;
  build_number: string;
  build_increment: number;
  cutter_body_serial_number: string;
  summary_id: Uuid;
  summary_number: string;
  summary_model: string;
  part_type_id: Uuid;
  part_type_code: string;
  blade_count: number;
  source_tray_serial_number: string;
  honed: boolean;
  coated: boolean;
  ib_ro: number | null;
  ob_ro: number | null;
  comments: string | null;
  built_at: Date;
  built_by_user_id: Uuid | null;
  cutter_builder_machine_id: Uuid | null;
  cutter_builder_machine_number: string | null;
  status_code: string;
}

export interface ICutterBuilderBuildResult {
  build: ICutterCardData;
  blade_ids: Uuid[];
  tray_released: boolean;
}
