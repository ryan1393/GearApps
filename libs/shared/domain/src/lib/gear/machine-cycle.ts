import { BaseEntity } from '../common/entity';
import { Gearset } from './gearset';
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
}
export type CreateMachineCycle = Pick<
  MachineCycle,
  'machine_id' | 'gearset_id' | 'serial_number' | 'consec' | 'timestamp'
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
}
export interface CycleHistoryPage {
  items: CycleHistoryRow[];
  total: number;
  page: number;
  page_size: number;
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
