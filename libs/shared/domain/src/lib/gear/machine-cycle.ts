import { BaseEntity } from '../common/entity';
import { Gearset } from './gearset';
import { ARGONAUT_MACROS } from './argonaut';
import { Machine } from './machine';

/** One lapping cycle run on a machine for a gearset. */
export interface MachineCycle extends BaseEntity {
  machine_id: string;
  machine?: Machine;
  gearset_id: string;
  gearset?: Gearset;
  serial_number: string | null;
  consec: number;
  timestamp: Date | string;
  /**
   * Seconds the lapper was in cycle (Y3.2), as Lapper Read measured it. Null when unknown: the
   * collector missed the cycle's start or end, or the cycle was recorded before it sent this.
   */
  cycle_time_s?: number | null;
}
export type CreateMachineCycle = Pick<
  MachineCycle,
  'machine_id' | 'gearset_id' | 'serial_number' | 'consec' | 'timestamp' | 'cycle_time_s'
>;
export type UpdateMachineCycle = Partial<Omit<MachineCycle, 'id' | 'machine' | 'gearset'>>;

/** One row of the cycle history table. */
export interface CycleHistoryRow {
  id: string;
  machine_id: string;
  gearset_id: string;
  serial_number: string | null;
  consec: number;
  timestamp: Date | string;
  /** Macro values recorded with this cycle. Only values that changed are recorded. */
  changed_count: number;
  /** Seconds in cycle; null when unknown. */
  cycle_time_s: number | null;
}
/** How many of the most recent timed cycles the average cycle time covers. */
export const CYCLE_TIME_AVERAGE_OF = 20;
/** Cycle times of a machine and gearset, whatever serial the history is filtered by. */
export interface CycleTimeStats {
  /** Average of the most recent timed cycles (up to CYCLE_TIME_AVERAGE_OF); null when none is timed. */
  average_s: number | null;
  /** How many timed cycles the average covers. */
  average_of: number;
}
export interface CycleHistoryPage {
  items: CycleHistoryRow[];
  total: number;
  page: number;
  page_size: number;
  /** Absent from servers before cycle times were recorded. */
  cycle_time?: CycleTimeStats;
}

/**
 * A cycle time for display: minutes, seconds and tenths, such as 2:04.3 for 124.25 seconds.
 * An em dash when it is unknown.
 */
export function formatCycleTime(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** One lapper's production, for the dashboard's machine-by-machine table. */
export interface LapperMachineProduction {
  machine_id: string;
  number: string;
  cell: string | null;
  status: string;
  cycles_1h: number;
  cycles_24h: number;
  missing_serial_24h: number;
  last_cycle_at: string | null;
  /** Gearset and serial of the most recent cycle in the past 24 hours. */
  last_gearset_id: string | null;
  last_gearset: string | null;
  last_serial_number: string | null;
}
export interface LapperProduction {
  cycles_24h: number;
  machines_reporting_24h: number;
  missing_serial_24h: number;
  last_cycle_at: string | null;
  machines: LapperMachineProduction[];
}

/**
 * Macros that change on every cycle by design, so a change in them is not a setting change.
 * #10032 is the consecutive cycle counter (consec).
 */
export const PER_CYCLE_MACROS: readonly number[] = [10032];
/**
 * The only macros a setting change is flagged for: the 68 sent to Argonaut, never a per-cycle
 * counter. Admin > Macros > Flag changes can switch one of these off but cannot add any other.
 */
export const FLAGGABLE_MACROS: readonly number[] = ARGONAUT_MACROS.filter((n) => !PER_CYCLE_MACROS.includes(n));
export const macroCanFlagChanges = (number: unknown): boolean => FLAGGABLE_MACROS.includes(Number(number));
/** The Lapper Dashboard flags setting changes over this many hours. */
export const SETTING_CHANGE_HOURS = 8;

/** One value a cycle changed: what it was on the machine and gearset's previous reading, and now. */
export interface SettingChangeValue {
  number: number;
  name: string;
  unit: string | null;
  previous_value: number;
  value: number;
}
/**
 * A cycle that changed something other than the consec counter (PER_CYCLE_MACROS) since the
 * previous reading of the same machine and gearset. A value's first reading is not a change.
 */
export interface SettingChangeCycle {
  machine_cycle_id: string;
  machine_id: string;
  machine_number: string | null;
  gearset_id: string;
  gearset_number: string | null;
  serial_number: string | null;
  consec: number;
  timestamp: Date | string;
  changes: SettingChangeValue[];
}
export interface SettingChanges {
  hours: number;
  /** Every flagged cycle in the window; `items` holds the newest of them. */
  total: number;
  items: SettingChangeCycle[];
}
