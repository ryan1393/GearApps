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
  /**
   * FTP folder holding this scanner's captures. Null uses the default,
   * `<SCANNER_FTP_ROOT>/<scanner IP>`.
   */
  image_folder?: string | null;
  /** Capture file in that folder (JPEG or BMP). Null uses `SCANNER_FTP_IMAGE_FILE`. */
  image_file?: string | null;
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
  | 'image_folder'
  | 'image_file'
>;
export type UpdateScannerDetail = Partial<Omit<ScannerDetail, 'id' | 'machine'>>;
export type UpdateScannerSerialNumbers = Partial<
  Pick<ScannerDetail, 'sn_procces' | 'sn_queue' | 'sn_scanner'>
>;

/** One level of the scanner FTP drop, for choosing a scanner's image folder and file. */
export interface ScannerFtpListing {
  /** The folder listed, as the FTP server names it. */
  path: string;
  /** The default folder root (`SCANNER_FTP_ROOT`). */
  root: string;
  /** The default image file name (`SCANNER_FTP_IMAGE_FILE`). */
  defaultImageFile: string;
  folders: string[];
  /** JPEG and BMP files, newest first. */
  images: { name: string; size: number; modifiedAt: string | null }[];
}
