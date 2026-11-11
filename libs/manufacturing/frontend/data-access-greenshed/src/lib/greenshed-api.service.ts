import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ILocation } from '@meshforge/manufacturing/shared/util-types';
import { CmmMeasurements, FrequencyMeasurements } from './quality-measurements';

export interface PartMasterRow {
  id: string;
  part_number: string;
  summary_id: string;
  part_type_id: string;
  teeth: number | null;
  roll_master?: {
    id: string;
    required_count: number;
    current_quantity: number;
    minimum_quantity: number;
    active: boolean;
    enabled: boolean;
    notes: string | null;
  } | null;
  active: boolean;
  enabled: boolean;
  summary?: {
    id: string;
    number: string;
    model_id?: string | null;
    model?: { model_number: number | null; model_type: string | null } | null;
  };
  part_type?: {
    id: string;
    code: string;
    name: string;
  };
}

export interface GreenshedReferenceData {
  check_types: Array<{ code: string; name: string }>;
  pull_reasons: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    requires_teardown: boolean;
    returns_to_shelf: boolean;
  }>;
  check_results: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
  }>;
  check_interval: number;
  /** True when DSF credits production to cutters: the running count moves on its own. Absent on older APIs. */
  dsf_cutter_counts?: boolean;
}

export interface GreenshedBuild {
  id: string;
  build_number: string;
  build_increment: number;
  cutter_body_serial_number: string;
  summary_number: string;
  summary_model: string;
  part_type_code: string;
  status_code: string;
  built_at: string;
  /** For a cutter on a Greenshed shelf: the counts its next setup continues from. */
  changeover_piece_count?: number | null;
  changeover_last_check_piece_count?: number | null;
  machine_run: null | {
    id: string;
    machine_number: string;
    part_number: string;
    current_piece_count: number;
    last_check_piece_count: number;
    next_check_piece_count: number;
    installed_at: string;
  };
  shelf_location: null | {
    serial_number: string;
    number: string;
    description: string | null;
  };
}

export interface GreenshedDashboard {
  counts: {
    running: number;
    checks_due: number;
    on_shelf: number;
    pulled_for_cutter_builder: number;
    ready_for_setup: number;
    available: number;
  };
  active_machines: Array<{
    run_id: string;
    build_number: string;
    part_number: string;
    cutter_body_serial_number: string;
    summary_number: string;
    part_type_code: string;
    machine_number: string;
    current_piece_count: number;
    last_check_piece_count: number;
    next_check_piece_count: number;
    pieces_until_check: number;
    check_due: boolean;
    installed_at: string;
  }>;
  available_cutters: Array<{
    build_number: string;
    cutter_body_serial_number: string;
    summary_number: string;
    part_type_code: string;
    status_code: string;
    shelf_location: string | null;
    shelf_description: string | null;
    placed_at: string | null;
    built_at: string;
  }>;
    shelf_cutters: Array<{
    build_number: string;
    cutter_body_serial_number: string;
    summary_number: string;
    part_type_code: string;
    shelf_location: string;
    shelf_description: string | null;
    placed_at: string;
  }>;
}



export interface RunningMachineRow {
  run_id?: string | null;
  machine_id: string;
  machine_number: string;
  department_code: string;
  cell: number | null;
  machine_active: boolean;
  machine_background_color: string;
  has_cutter: boolean;
  build_number: string | null;
  part_number: string | null;
  summary_number: string | null;
  part_type_code: string | null;
  cutter_body_serial_number: string | null;
  shift: string | null;
  current_piece_count: number;
  // DANA-R61R14-COUNT-CONTRACT
  shift_piece_count?: number;
  last_check_code: string | null;
  last_check_name: string | null;
  last_check_result: string | null;
  last_check_at: string | null;
  next_check_piece_count: number | null;
  check_due: boolean;
}

export interface GreenshedCurrentShift {
  number: number;
  label: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  tracking_started_at: string;
  is_complete: boolean;
}

export interface RunningMachinesBoard {
  current_shift?: GreenshedCurrentShift;
  active_filter: 'ALL' | 'ACTIVE' | 'INACTIVE';
  refreshed_at: string;
  departments: Array<{
    department_code: string;
    machines: RunningMachineRow[];
  }>;
}

export interface GreenshedMachine {
  machine_id: string;
  machine_number: string;
  department_code: string;
  cell: number | null;
  machine_active: boolean;
  active_run: null | {
    run_id: string;
    build_number: string;
    part_number: string;
    cutter_body_serial_number: string;
    summary_number: string;
    part_type_code: string;
    current_piece_count: number;
    last_check_piece_count: number;
    next_check_piece_count: number;
    pieces_until_check: number;
    check_due: boolean;
    installed_at: string;
  };
}

export interface PieceCountUpdateResult {
  build_number: string;
  machine_number: string;
  current_piece_count: number;
  next_check_piece_count: number;
  pieces_until_check: number;
  check_due: boolean;
}

export interface GreenshedSearchRow {
  id: string;
  build_number: string;
  cutter_body_serial_number: string;
  summary_number: string;
  part_type_code: string;
  status_code: string;
  built_at: string;
}


export interface GreenshedSetupResult {
  run_id: string;
  build_number: string;
  machine_number: string;
  part_number: string;
  current_piece_count: number;
  next_check_piece_count: number;
  status_code: string;
  installed_at: string;
}

export interface GreenshedQualityCheckResult {
  event_id: string;
  build_number: string;
  machine_number: string;
  check_type_code: string;
  result_code: string;
  piece_count: number;
  next_check_piece_count: number;
  occurred_at: string;
}

export interface GreenshedPullResult {
  build_number: string;
  cutter_body_serial_number: string;
  machine_number: string;
  part_number: string;
  final_piece_count: number;
  reason_code: string;
  status_code: string;
  requires_teardown: boolean;
  returned_to_shelf: boolean;
  shelf_location: string | null;
  removed_at: string;
}

export interface GreenshedHistoryEvent {
  id: string;
  piece_count: number;
  machine_number: string | null;
  part_number: string | null;
  occurred_at: string;
  comments: string | null;
  recorded_by?: string | null;
  canceled_at?: string | null;
  canceled_by?: string | null;
  event_type?: {
    code: string;
    name: string;
  } | null;
  check_result?: {
    code: string;
    name: string;
  } | null;
  pull_reason?: {
    code: string;
    name: string;
  } | null;
}

/** One machine's current-shift production as read from DSF (Digital Shop Floor). */
export interface DsfCountRow {
  machine_id: string; machine_number: string; department: string;
  status: 'NOT_CONFIGURED' | 'WAITING' | 'OK' | 'STALE' | 'MAPPING_REVIEW' | 'SHIFT_REVIEW' | 'DATA_REVIEW' | 'UNAVAILABLE' | 'INACTIVE';
  count: number | null; note: string; shift_number: number | null; shift_date: string | null;
  shift_start: string | null; shift_end: string | null; as_of: string | null; refreshed_at: string | null;
}
export interface DsfCountsBoard {
  format: string; status: string; configured: boolean; interval_seconds: number;
  last_success_at: string | null; served_at: string;
  /** False when DSF production is credited to the installed cutter rather than only shown for comparison. */
  counts_are_comparison_only: boolean; cutter_write_enabled: boolean; rows: DsfCountRow[];
}

@Injectable({ providedIn: 'root' })
export class GreenshedApiService {
  private readonly http = inject(HttpClient);

  /** Reads the API's in-memory DSF snapshot. Never triggers a DSF read. */
  getDsfCounts() {
    return this.http.get<DsfCountsBoard>('/api/v1/greenshed/dsf-counts');
  }

  getDashboard() {
    return this.http.get<GreenshedDashboard>('/api/v1/greenshed/dashboard');
  }

  getReferenceData() {
    return this.http.get<GreenshedReferenceData>(
      '/api/v1/greenshed/reference-data',
    );
  }

  getPartByNumber(partNumber: string) {
    return this.http.get<PartMasterRow>(
      `/api/v1/parts/number/${encodeURIComponent(partNumber.trim())}`,
    );
  }

  getBuild(buildNumber: string) {
    return this.http.get<GreenshedBuild>(
      `/api/v1/greenshed/builds/${encodeURIComponent(buildNumber.trim())}`,
    );
  }

  getRunningMachines(active: 'ALL' | 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
    return this.http.get<RunningMachinesBoard>(
      '/api/v1/greenshed/running-machines',
      { params: { active } },
    );
  }

  getMachine(machineNumber: string) {
    return this.http.get<GreenshedMachine>(
      `/api/v1/greenshed/machines/${encodeURIComponent(machineNumber.trim())}`,
    );
  }

  getHistory(buildNumber: string) {
    return this.http.get<GreenshedHistoryEvent[]>(
      `/api/v1/greenshed/history/${encodeURIComponent(buildNumber.trim())}`,
    );
  }

  searchBuilds(q = '', status = '') {
    const params: Record<string, string> = {};
    if (q.trim()) params['q'] = q.trim();
    if (status.trim()) params['status'] = status.trim();
    return this.http.get<GreenshedSearchRow[]>('/api/v1/greenshed/builds', {
      params,
    });
  }

  scanLocation(serialNumber: string) {
    return this.http.get<ILocation>(
      `/api/v1/locations/scan/${encodeURIComponent(serialNumber.trim())}`,
    );
  }

  setupCutter(input: {
    buildNumber: string;
    machineNumber: string;
    partNumber: string;
    shift?: string | null;
    startingPieceCount?: number;
    comments?: string | null;
  }) {
    return this.http.post<GreenshedSetupResult>('/api/v1/greenshed/setup', {
      build_number: input.buildNumber,
      machine_number: input.machineNumber,
      part_number: input.partNumber.trim(),
      shift: input.shift?.trim() || null,
      starting_piece_count: input.startingPieceCount ?? 0,
      comments: input.comments?.trim() || null,
    });
  }

  updatePieceCount(machineNumber: string, pieceCount: number) {
    return this.http.post<PieceCountUpdateResult>(
      `/api/v1/greenshed/machines/${encodeURIComponent(machineNumber.trim())}/piece-count`,
      { piece_count: pieceCount },
    );
  }

  qualityCheck(input: {
    buildNumber: string;
    checkTypeCode: string;
    resultCode: string;
    pieceCount: number;
    comments?: string | null;
    expectedMachineNumber?: string;
    expectedMachineRunId?: string;
    frequency?: FrequencyMeasurements;
    cmm?: CmmMeasurements;
  }) {
    return this.http.post<GreenshedQualityCheckResult>('/api/v1/greenshed/quality-check', {
      build_number: input.buildNumber,
      check_type_code: input.checkTypeCode,
      result_code: input.resultCode,
      piece_count: input.pieceCount,
      comments: input.comments?.trim() || null,
      expected_machine_number: input.expectedMachineNumber,
      expected_machine_run_id: input.expectedMachineRunId,
      frequency: input.checkTypeCode === 'FC' ? input.frequency : undefined,
      cmm: input.checkTypeCode === 'CMM' ? input.cmm : undefined,
    });
  }

  pullCutter(input: {
    buildNumber: string;
    reasonCode: string;
    shelfLocationSerial?: string | null;
    comments?: string | null;
    expectedMachineNumber?: string;
    expectedMachineRunId?: string;
  }) {
    return this.http.post<GreenshedPullResult>('/api/v1/greenshed/pull', {
      build_number: input.buildNumber,
      reason_code: input.reasonCode,
      shelf_location_serial_number: input.shelfLocationSerial?.trim() || null,
      comments: input.comments?.trim() || null,
      expected_machine_number: input.expectedMachineNumber,
      expected_machine_run_id: input.expectedMachineRunId,
    });
  }
}

export function greenshedApiErrorText(
  error: HttpErrorResponse,
  fallback: string,
): string {
  const message = error.error?.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
}
