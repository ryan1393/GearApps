export const CUTTER_REQUEST_STATUSES = ['REQUESTED', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELED'] as const;
export type CutterRequestStatus = typeof CUTTER_REQUEST_STATUSES[number];

/** Saved request fields returned by creation and manual status changes. Quantities are cutters. */
export interface CutterRequestRecord {
  id: string;
  summary_id: string;
  part_type_id: string;
  requested_quantity: number;
  remaining_quantity: number;
  status: CutterRequestStatus;
  notes: string | null;
  requested_by: string | null;
  /** Optional for compatibility with historical responses that omitted update attribution. */
  updated_by?: string | null;
  requested_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Request queue projection, including fulfillment evidence and computed display status. */
export interface CutterRequestRow extends CutterRequestRecord {
  summary_number: string;
  part_type_code: string;
  /** Derived from linked build evidence, never inferred from Remaining after manual closure. */
  built_quantity: number;
  requested_by_name?: string | null;
  updated_by_name?: string | null;
  stored_status?: string;
  work_started?: boolean;
  build_ids?: string[];
  build_numbers?: string[];
  builds?: Array<{ id: string; build_number: string }>;
  allocation_inconsistent?: boolean;
}
