import { BaseEntity } from '../common/entity';
import { Machine } from './machine';

/** Live PLC/Fanuc I/O snapshot for a machine. Column names mirror the Fanuc addresses. */
export interface MachineFanucVariable extends BaseEntity {
  x06_7_frt_dr_closed: boolean;
  x01_2_start_cycle: boolean;
  y03_2_stack_inCycle: boolean;
  machine_id: string;
  machine?: Machine;
}
export type CreateMachineFanucVariable = Pick<
  MachineFanucVariable,
  'x06_7_frt_dr_closed' | 'x01_2_start_cycle' | 'y03_2_stack_inCycle' | 'machine_id'
>;
export type UpdateMachineFanucVariable = Partial<
  Pick<MachineFanucVariable, 'x06_7_frt_dr_closed' | 'x01_2_start_cycle' | 'y03_2_stack_inCycle'>
>;
