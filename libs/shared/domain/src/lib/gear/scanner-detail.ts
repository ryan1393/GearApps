import { BaseEntity } from '../common/entity';
import { Machine } from './machine';

/** A barcode scanner attached to a lapping machine. */
export interface ScannerDetail extends BaseEntity {
  ip: string | null;
  model: string | null;
  type: string | null;
  description: string | null;
  /** Serial number currently in process on the machine. (DB column kept as `sn_procces`.) */
  sn_procces: string | null;
  sn_queue: string | null;
  sn_scanner: string | null;
  status: string;
  machine_id: string | null;
  machine?: Machine;
}
export type CreateScannerDetail = Pick<
  ScannerDetail,
  | 'ip'
  | 'model'
  | 'type'
  | 'description'
  | 'sn_procces'
  | 'sn_queue'
  | 'sn_scanner'
  | 'machine_id'
  | 'status'
>;
export type UpdateScannerDetail = Partial<Omit<ScannerDetail, 'id' | 'machine'>>;
export type UpdateScannerSerialNumbers = Partial<
  Pick<ScannerDetail, 'sn_procces' | 'sn_queue' | 'sn_scanner'>
>;
