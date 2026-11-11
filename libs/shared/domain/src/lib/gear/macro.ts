import { BaseEntity } from '../common/entity';
import { MachineCycle } from './machine-cycle';

/** Form groups a macro belongs to on the lapping summary screen. */
export const MACRO_FORMS = [
  'gear_data',
  'general_data',
  'mesh',
  'coast',
  'drive',
  'tip_coast',
  'tip_drive',
  'root_coast',
  'root_drive',
] as const;
export type MacroForm = (typeof MACRO_FORMS)[number];

/** A Fanuc macro variable definition (e.g. #10032 Consec-No). */
export interface Macro extends BaseEntity {
  number: number;
  name: string;
  status: number | null;
  type: string;
  tab_index: number | null;
  used_form: MacroForm | string | null;
  l60_table: string;
  extra: string | null;
  /** Lowest acceptable value. Null or absent means no lower limit. */
  min_value?: number | null;
  /** Highest acceptable value. Null or absent means no upper limit. */
  max_value?: number | null;
  /** Unit shown beside the value, for example mm or rpm. */
  unit?: string | null;
}
export type CreateMacro = Pick<
  Macro,
  | 'number'
  | 'name'
  | 'status'
  | 'type'
  | 'tab_index'
  | 'used_form'
  | 'l60_table'
  | 'extra'
  | 'min_value'
  | 'max_value'
  | 'unit'
>;
export type UpdateMacro = Partial<Omit<Macro, 'id'>>;

/** A recorded macro value for a specific machine cycle. */
export interface MacroLog extends BaseEntity {
  machine_cycle_id: string;
  machine_cycle?: MachineCycle;
  macro_id: string;
  macro?: Macro;
  value: number;
}
export type CreateMacroLog = Pick<MacroLog, 'machine_cycle_id' | 'macro_id' | 'value'>;
export type UpdateMacroLog = Partial<Pick<MacroLog, 'value'>>;

/**
 * Flattened row returned by the lapping-summary query: the latest value of
 * each macro for a (machine, gearset) pair, joined with the macro definition.
 */
export interface LappingSummaryRow {
  id: string;
  machine_cycle_id: string;
  macro_id: string;
  number: number;
  name: string;
  status: number | null;
  type: string;
  tab_index: number | null;
  used_form: string | null;
  l60_table: string;
  extra: string | null;
  min_value?: number | null;
  max_value?: number | null;
  unit?: string | null;
  value: number;
}

export type MacroLimitState = 'ok' | 'low' | 'high';
/** Where a recorded value sits against the limits set for its macro in Admin > Macros. */
export function macroLimitState(
  value: number | null | undefined,
  limits: Pick<Macro, 'min_value' | 'max_value'>,
): MacroLimitState {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'ok';
  if (typeof limits.min_value === 'number' && value < limits.min_value) return 'low';
  if (typeof limits.max_value === 'number' && value > limits.max_value) return 'high';
  return 'ok';
}
/** "5 to 12 mm", "at least 5", "at most 12 mm" or null when the macro has no limits. */
export function macroLimitText(limits: Pick<Macro, 'min_value' | 'max_value' | 'unit'>): string | null {
  const { min_value: min, max_value: max } = limits;
  const unit = limits.unit ? ' ' + limits.unit : '';
  if (typeof min === 'number' && typeof max === 'number') return `${min} to ${max}${unit}`;
  if (typeof min === 'number') return `at least ${min}${unit}`;
  if (typeof max === 'number') return `at most ${max}${unit}`;
  return null;
}
