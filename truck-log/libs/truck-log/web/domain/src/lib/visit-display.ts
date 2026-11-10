import type { VisitEventRecord } from '@truck-log/shared/contracts';

const STATUS_LABELS: Record<string, string> = {
  DOCK_ASSIGNED: 'At / Sent to Dock',
  DOCK_COMPLETE: 'Dock Complete — Return to Guard',
  GUARD_CHECKED_OUT: 'Checked Out',
};

const EVENT_LABELS: Record<string, string> = {
  GUARD_CHECK_IN: 'Guard checked driver in',
  DOCK_ASSIGNED: 'Dock assigned',
  DOCK_COMPLETE: 'Dock service completed',
  FINAL_GUARD_CHECKOUT: 'Guard completed final checkout',
  DOCUMENT_ADDED: 'Paperwork added',
  PACKING_SLIP_UPLOADED: 'Packing slip uploaded',
  SAP_DELIVERY_NUMBER_SCANNED: 'Scanned SAP Delivery Number saved to visit',
  SAP_DELIVERY_NUMBER_ENTERED: 'Manually entered SAP Delivery Number saved to visit',
  PACKING_SLIP_CONFIRMED: 'Packing-slip PDF reviewed, confirmed and attached',
  PACKING_SLIP_AUTO_ATTACHED: 'Packing-slip PDF matched the scanned number and was attached',
  PACKING_SLIP_SCANNED: 'Scanned packing-slip PDF confirmed and attached',
  PACKING_SLIP_REPLACED: 'Packing slip replaced',
  RXO_DOCUMENT_UPLOADED: 'RXO driver document uploaded',
  RXO_DOCUMENT_REPLACED: 'RXO driver document replaced',
  RXO_DOCUMENT_SUPERSEDED: 'Prior RXO document version superseded',
  RXO_DOCUMENT_ASSOCIATED_TO_VISIT: 'RXO driver document associated to visit',
  DRIVER_PRINT_PACKAGE_REQUESTED: 'Driver Print Package requested',
  DOCK_ASSIGNMENT_PRINTED: 'Dock Assignment Slip printed',
  DOCK_ASSIGNMENT_PRINT_FAILED: 'Dock Assignment Slip print failed',
  RXO_DOCUMENT_PRINTED: 'RXO driver document printed',
  RXO_DOCUMENT_PRINT_FAILED: 'RXO driver document print failed',
  RXO_DOCUMENT_PRINT_RETRIED: 'RXO driver document print retried',
  RXO_DOCUMENT_REPRINTED: 'RXO driver document reprinted',
  RXO_DOCUMENT_PRINTED_LATE_RESULT: 'RXO driver document printed (Print Agent reported late)',
  RXO_DOCUMENT_PRINT_FAILED_LATE_RESULT: 'RXO driver document print failed (Print Agent reported late)',
  AUTO_DOCK_ASSIGNMENT_PRINT_PRINTED: 'Dock Assignment Slip printed at the gate',
  AUTO_DOCK_ASSIGNMENT_PRINT_FAILED: 'Dock Assignment Slip print failed at the gate',
  AUTO_RXO_DOCUMENT_PRINT_PRINTED: 'RXO driver document printed at the gate',
  AUTO_RXO_DOCUMENT_PRINT_FAILED: 'RXO driver document print failed at the gate',
  AUTO_DOCK_ASSIGNMENT_PRINT_PRINTED_LATE_RESULT: 'Dock Assignment Slip printed at the gate (Print Agent reported late)',
  AUTO_DOCK_ASSIGNMENT_PRINT_FAILED_LATE_RESULT: 'Dock Assignment Slip print failed at the gate (Print Agent reported late)',
  AUTO_RXO_DOCUMENT_PRINT_PRINTED_LATE_RESULT: 'RXO driver document printed at the gate (Print Agent reported late)',
  AUTO_RXO_DOCUMENT_PRINT_FAILED_LATE_RESULT: 'RXO driver document print failed at the gate (Print Agent reported late)',
};

export function visitStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export function recordStatusLabel(status: string): string {
  if (status === 'DOCK_COMPLETE') return 'Dock Complete — Awaiting Guard';
  return visitStatusLabel(status);
}

export function visitEventLabel(event: VisitEventRecord): string {
  return EVENT_LABELS[event.eventType] ?? event.eventType.replace(/_/g, ' ');
}

export function elapsedSince(start: string, now = Date.now()): string {
  const startMs = new Date(start).getTime();
  const elapsedMs = now - startMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '—';

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
