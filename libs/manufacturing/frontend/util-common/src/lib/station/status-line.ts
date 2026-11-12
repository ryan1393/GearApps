import { ScanMessage } from './scan-message';

/**
 * Turns a page's `error` / `message` strings into the one message its station status line shows.
 * The same object comes back until the text changes, so the line only re-announces (and an error
 * only flashes) for a new message, not on every change-detection pass.
 */
export function createStatusLine(): (error: string, success: string, info?: string) => ScanMessage | null {
  let key = '';
  let value: ScanMessage | null = null;
  return (error, success, info = '') => {
    const next: ScanMessage | null = error ? { tone: 'error', text: error }
      : success ? { tone: 'success', text: success }
        : info ? { tone: 'info', text: info } : null;
    const nextKey = next ? `${next.tone}:${next.text}` : '';
    if (nextKey !== key) {
      key = nextKey;
      value = next;
    }
    return value;
  };
}

/** The status-line text for a scan made while the station was busy that could not be used. */
export function heldScanIgnoredText(scan: string): string {
  return `Scan ${scan} ignored — wait for the previous step to finish, then scan again.`;
}
