/** Shared contracts for the MeshForge plant dashboard and cached DSF responses. */
export interface MachineCount {
  machine_id: string;
  machine_number: string;
  department: string;
  status: string;
  count: number | null;
  note: string;
  shift_number: number | null;
  shift_date: string | null;
  shift_start: string | null;
  shift_end: string | null;
  as_of: string | null;
  refreshed_at: string | null;
}

export interface ProductionSnapshot {
  format: 'DSFCOUNT1';
  configured: boolean;
  interval_seconds: number;
  last_success_at: string | null;
  served_at: string;
  rows: MachineCount[];
}

export interface ShiftReport {
  key: string;
  department: string;
  date: string | null;
  shift: number | null;
  start: string | null;
  end: string | null;
  machines: number;
  reporting: number;
  pieces: number | null;
}

export interface DsfSource {
  mapping_id: string;
  department: string;
  whiteboard_name: string;
  line_name: string;
  mapping_active: boolean;
  whiteboard_active: boolean;
  assigned_machine_id: string | null;
}

export interface DsfMappingSnapshot {
  format: 'DSFMAPADMIN1';
  configured: boolean;
  interval_seconds: number;
  source_options_status: string;
  source_options_refreshed_at: string | null;
  source_options: DsfSource[];
}

export interface DepartmentCoverage {
  code: string;
  inReference: boolean;
  registered: number;
  sourceMappings: number | null;
  unlinkedActiveSources: number | null;
}
