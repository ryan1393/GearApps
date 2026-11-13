export interface DockScanKey {
  key: string; timeStamp: number; isTrusted: boolean; repeat: boolean;
  ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; isComposing?: boolean;
}
export type DockScanInputResult = { type: 'pending' } | { type: 'rejected' } | { type: 'complete'; value: string };

/** a workflow heuristic for keyboard-wedge USB scanners, not device authentication.
 * No typing field, paste, edit keys, partial-code submission, or unattended global capture.
 */
export class DockScanInput {
  private text = '';
  private started = 0;
  private last = 0;
  private invalid = false;
  reset(): void { this.text = ''; this.started = 0; this.last = 0; this.invalid = false; }
  feed(event: DockScanKey): DockScanInputResult {
    if (!event.isTrusted || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
        !Number.isFinite(event.timeStamp)) { this.invalid = true; return { type: 'rejected' }; }
    if (event.key === 'Enter') {
      const value = this.text;
      const accepted = !this.invalid && /^[0-9]{8}$/.test(value) && event.timeStamp >= this.last &&
        event.timeStamp - this.last <= 100 && event.timeStamp - this.started <= 600;
      this.reset();
      return accepted ? { type: 'complete', value } : { type: 'rejected' };
    }
    if (!/^[0-9]$/.test(event.key)) { this.invalid = true; return { type: 'rejected' }; }
    // Discard an idle/incomplete burst so the next whole barcode can be scanned.
    if (this.text && event.timeStamp - this.last > 250) this.reset();
    if (this.text && (event.timeStamp < this.last || event.timeStamp - this.last > 100)) this.invalid = true;
    if (!this.text) this.started = event.timeStamp;
    if (this.text.length >= 8) { this.invalid = true; return { type: 'rejected' }; }
    this.text += event.key;
    this.last = event.timeStamp;
    return { type: 'pending' };
  }
}
