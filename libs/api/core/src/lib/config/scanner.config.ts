import { registerAs } from '@nestjs/config';

/** Scanner HTTP and TCP connections and FTP image drop used by the lapping-cell live view. */
export const scannerConfig = registerAs('scanner', () => ({
  /** Default scanner host used when a scanner record has no IP. */
  defaultHost: process.env['SCANNER_DEFAULT_HOST'] ?? '',
  /** Accept self-signed certs from scanners on the plant network. */
  allowInsecureTls: (process.env['SCANNER_ALLOW_INSECURE_TLS'] ?? 'true') === 'true',
  timeoutMs: parseInt(process.env['SCANNER_TIMEOUT_MS'] ?? '4000', 10),
  commandPort: Number(process.env['LAPPER_READ_SCANNER_PORT'] || '9004'),
  /**
   * Lapper Read's status server. A scanner accepts one command connection, which the collector holds,
   * so dashboard commands for a scanner it reads go through it.
   */
  collectorUrl: process.env['LAPPER_READ_STATUS_URL'] || 'http://lapper-read:8080',
  ftp: {
    host: process.env['SCANNER_FTP_HOST'] ?? '',
    user: process.env['SCANNER_FTP_USER'] ?? '',
    password: process.env['SCANNER_FTP_PASSWORD'] ?? '',
    /** Root folder on the FTP server; images live at `<root>/<scanner-ip>/scanner-current.jpg`. */
    root: process.env['SCANNER_FTP_ROOT'] ?? '181-lapper-scanners',
    imageFile: process.env['SCANNER_FTP_IMAGE_FILE'] ?? 'scanner-current.jpg',
  },
}));
