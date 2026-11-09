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
}
export type CreateMacro = Pick<
  Macro,
  'number' | 'name' | 'status' | 'type' | 'tab_index' | 'used_form' | 'l60_table' | 'extra'
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
  value: number;
}
