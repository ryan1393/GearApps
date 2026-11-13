/** Expedite shipment identity shared by the mirror, document state and check-in rows. */

export const EXPEDITE_DOCUMENT_SITE_KEY = 'fort-wayne-expedite';

export function expediteDirection(row: Record<string, unknown>): 'INBOUND' | 'OUTBOUND' | 'UNKNOWN' {
  const origin = `${String(row.originName ?? '')} ${String(row.origin ?? '')}`;
  const destination = String(row.destination ?? '');
  const originFortWayne = /\bfort\s+wayne\b/i.test(origin);
  const destinationFortWayne = /\bfort\s+wayne\b/i.test(destination);
  if (originFortWayne && !destinationFortWayne) return 'OUTBOUND';
  if (destinationFortWayne && !originFortWayne) return 'INBOUND';
  return 'UNKNOWN';
}
