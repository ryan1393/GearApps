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
  /**
   * Argonaut (Track and Trace) endpoint Lapper Read posts this machine's finished cycles to.
   * Empty: the collector's default (ARGONAUT_ENABLED / ARGONAUT_URL) applies.
   */
  argonaut_url?: string | null;
  /** Argonaut `locationId` for this machine; empty uses the collector's ARGONAUT_LOCATION_ID. */
  argonaut_location_id?: string | null;
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
  | 'argonaut_url'
  | 'argonaut_location_id'
>;
export type UpdateMachine = Partial<Omit<Machine, 'id' | 'number' | 'scanner'>>;
