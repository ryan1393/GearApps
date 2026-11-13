/**
 * Holds at most one blob: URL (for example a packing-slip PDF opened in a
 * print window). Opening a new document or releasing the slot revokes the
 * previous URL after a grace period, so all-day screens do not accumulate
 * PDFs in memory while a window that is still loading keeps working.
 */
export class ObjectUrlSlot {
  private current: string | null = null;

  constructor(private readonly graceMs = 60000) {}

  /** Create a URL for this blob; the previously held URL is scheduled for revocation. */
  open(blob: Blob): string {
    this.release();
    this.current = URL.createObjectURL(blob);
    return this.current;
  }

  /** Schedule revocation of the held URL (dialog closed, component destroyed). */
  release() {
    const url = this.current;
    this.current = null;
    if (!url) return;
    if (this.graceMs <= 0) { URL.revokeObjectURL(url); return; }
    setTimeout(() => URL.revokeObjectURL(url), this.graceMs);
  }
}
