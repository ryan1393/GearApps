/** Internal staged history contracts: source reads never write to MeshForge. */
export interface HistoryQueryClient {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface HistorySource {
  source_key: string;
  system_key: string;
  mapping_id: string;
  whiteboard_id: string;
  op_id: string;
  line_id: string;
  department_id: string | null;
  source_name: string;
  line_name: string;
  department_name: string;
  asset_number: string | null;
  active: boolean;
  duplicate_operation: boolean;
  review_reason: string | null;
}

export interface HistorySlice {
  source_key: string;
  hour_start: string;
  slice_start: string;
  slice_end: string;
  shift_id: string | null;
  shift_number: number | null;
  shift_date: string | null;
  shift_start: string | null;
  shift_end: string | null;
  count: number;
}

export interface HistoryHour {
  source_key: string;
  hour_start: string;
  covered_to: string;
  count: number;
  source_rows: number;
  last_production_at: string | null;
  slices: HistorySlice[];
}

export interface HistoryIssue {
  source_key: string | null;
  hour_start: string;
  code: string;
}

export interface HistoryPlan {
  system_key: string;
  backfill_start: string;
  backfill_hour: string;
  /** Canonical UTC hours; current, previous and one resumable backfill hour. */
  hours: string[];
}

export interface HistoryCapture {
  system_key: string;
  source_as_of: string;
  sources: HistorySource[];
  hours: HistoryHour[];
  issues: HistoryIssue[];
  backfill_start: string;
  next_backfill_hour: string;
}

export interface HistoryReportQuery {
  from: string;
  to: string;
  group: 'hour' | 'shift' | 'day';
  source_key?: string;
  department_id?: string;
  include_inactive: boolean;
}
