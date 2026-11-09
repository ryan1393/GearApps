import { BaseEntity } from '../common/entity';
import { ScannerDetail } from './scanner-detail';

export interface Machine extends BaseEntity {
  /** Asset ID, e.g. 01-094-999 */
  number: string | null;
  ip: string;
  dept_id: string | null;
  description: string | null;
  type: string | null;
  builder: string | null;
  cell: string | null;
  status: string;
  scanner_id?: string | null;
  scanner?: ScannerDetail;
}
export type CreateMachine = Pick<
  Machine,
  | 'number'
  | 'ip'
  | 'scanner_id'
  | 'dept_id'
  | 'description'
  | 'type'
  | 'builder'
  | 'cell'
  | 'status'
>;
export type UpdateMachine = Partial<Omit<Machine, 'id' | 'number' | 'scanner'>>;
