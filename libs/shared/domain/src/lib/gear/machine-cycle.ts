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

export interface LapperProduction {
  cycles_24h: number;
  machines_reporting_24h: number;
  missing_serial_24h: number;
  last_cycle_at: string | null;
}
