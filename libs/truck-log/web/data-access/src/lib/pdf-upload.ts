/**
 * Browser-side checks and retry bookkeeping for driver-document PDF uploads,
 * shared by RXO and RXO Expedite. The server remains authoritative; this is an
 * early check so an obviously wrong file is never sent.
 */
export async function pdfUploadValidationError(file: File, label = 'Driver documents'): Promise<string> {
  const maxBytes = 25 * 1024 * 1024;
  if (!file.size) return 'Choose a non-empty PDF.';
  if (file.size > maxBytes) return `${label} must be 25 MB or smaller.`;
  if (file.type && file.type.toLowerCase() !== 'application/pdf') return `${label} must be PDFs.`;
  try {
    const header = new TextDecoder('ascii').decode(await file.slice(0, 5).arrayBuffer());
    const tailStart = Math.max(0, file.size - 4096);
    const tail = new TextDecoder('ascii').decode(await file.slice(tailStart).arrayBuffer());
    if (header !== '%PDF-' || !tail.includes('%%EOF')) return 'The selected file is not a valid PDF.';
  } catch {
    return 'Truck Log could not inspect the selected PDF.';
  }
  return '';
}

/**
 * Keeps one idempotency key per (target, file) so a retry after a network
 * failure replays the same upload instead of creating a second version.
 */
export class UploadIdempotency {
  key = '';
  private fingerprint = '';

  /** The key for this upload: reused when the same file is retried for the same target. */
  keyFor(target: string, file: File, newKey: () => string): string {
    const fingerprint = JSON.stringify({
      shipment: target,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
    });
    if (!this.key || this.fingerprint !== fingerprint) {
      this.key = newKey();
      this.fingerprint = fingerprint;
    }
    return this.key;
  }

  /** The upload succeeded: the next upload gets a new key. */
  clear() {
    this.key = '';
    this.fingerprint = '';
  }

  /** A definitive 4xx rejection (not a timeout/rate limit) cannot be replayed; transient failures keep the key. */
  failed(status: number) {
    if (status >= 400 && status < 500 && ![408, 425, 429].includes(status)) this.clear();
  }
}

export function newUploadIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
