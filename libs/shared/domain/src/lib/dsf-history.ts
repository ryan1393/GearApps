/** Durable DSF count history. All timestamps have explicit UTC offsets. */
export type DsfHistoryGroup = 'hour' | 'shift' | 'day';
export type DsfHistoryCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'REVIEW';

export interface DsfHistorySource {
  source_key: string;
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
  current: boolean;
  duplicate_operation: boolean;
  review_reason: string | null;
  machine_id: string | null;
  machine_number: string | null;
  last_seen_at: string;
}

export interface DsfHistoryCollectorStatus {
  format: 'DSFHISTORYSTATUS1';
  enabled: boolean;
  available: boolean;
  source_reader_enabled: boolean;
  interval_seconds: number;
  lookback_days: number;
  retention: 'indefinite';
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_code: string | null;
  next_backfill_hour: string | null;
  backfill_start: string | null;
  source_count: number;
  active_source_count: number;
  earliest_hour: string | null;
  latest_covered_to: string | null;
  note: string;
}

export interface DsfHistorySourceSnapshot {
  format: 'DSFHISTORYSOURCES1';
  available: boolean;
  served_at: string;
  sources: DsfHistorySource[];
}

export interface DsfHistoryRecord {
  source_key: string;
  source_name: string;
  department_id: string | null;
  department_name: string;
  machine_number: string | null;
  asset_number: string | null;
  duplicate_operation: boolean;
  review_reason: string | null;
  period_start: string;
  period_end: string;
  count: number | null;
  completeness: DsfHistoryCompleteness;
  covered_seconds: number;
  expected_seconds: number;
  observed_at: string | null;
  shift_id: string | null;
  shift_number: number | null;
  shift_date: string | null;
}

export interface DsfHistoryReport {
  format: 'DSFHISTORY1';
  available: boolean;
  served_at: string;
  timezone: 'America/Indiana/Indianapolis';
  from: string;
  to: string;
  group: DsfHistoryGroup;
  rows: DsfHistoryRecord[];
  truncated: boolean;
  row_limit: number;
  totals: {
    count: number | null;
    known_subtotal: number;
    complete_records: number;
    partial_records: number;
    unknown_records: number;
    review_records: number;
    excluded_duplicate_sources: number;
  };
  note: string;
}
