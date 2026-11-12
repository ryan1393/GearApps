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

/** The server's default capture location (`SCANNER_FTP_ROOT`, `SCANNER_FTP_IMAGE_FILE`). */
export interface ScannerImageDefaults {
  root: string;
  imageFile: string;
}

/** Where MeshForge reads a scanner's capture on the FTP drop. */
export interface ScannerImagePath {
  /** Null when the scanner has neither an image folder nor an IP address. */
  folder: string | null;
  file: string;
  /** The folder is the default `<root>/<scanner IP>`, not one set on the scanner. */
  defaultFolder: boolean;
  /** The file is the default name, not one set on the scanner. */
  defaultFile: boolean;
}

/**
 * The FTP folder and file the API reads for a scanner: its own (Admin > Scanners) when set,
 * otherwise `<root>/<scanner IP>/<default file>`. When that file is missing the API shows the
 * newest JPEG or BMP in the same folder.
 */
export function resolveScannerImagePath(
  scanner: Pick<ScannerDetail, 'ip' | 'image_folder' | 'image_file'>,
  defaults: ScannerImageDefaults,
): ScannerImagePath {
  const own = scanner.image_folder?.trim().replace(/\/+$/, '') || null;
  const ownFile = scanner.image_file?.trim() || null;
  const ip = scanner.ip?.trim() || null;
  return {
    folder: own ?? (ip ? `${defaults.root.replace(/\/+$/, '')}/${ip}` : null),
    file: ownFile ?? defaults.imageFile,
    defaultFolder: !own,
    defaultFile: !ownFile,
  };
}
