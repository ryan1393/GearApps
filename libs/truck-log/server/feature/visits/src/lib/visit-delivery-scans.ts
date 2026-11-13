/** retain legacy scans and manual entries without inventing PDF rows.
 * The compatibility property scannedDeliveryNumbers now projects both event types.
 */
export const DELIVERY_SCAN_EVENT = 'SAP_DELIVERY_NUMBER_SCANNED';
export const DELIVERY_MANUAL_EVENT = 'SAP_DELIVERY_NUMBER_ENTERED';
const NOTE_PATTERN = /^SAP Delivery Number ([0-9]{8}) scanned and saved to this visit; PDF attachment is separate and optional\.$/;
const MANUAL_NOTE_PATTERN = /^SAP Delivery Number ([0-9]{8}) manually entered and saved to this visit; PDF attachment is separate and optional\.$/;
function validNumber(deliveryNumber: string): void {
  if (typeof deliveryNumber !== 'string' || deliveryNumber.length !== 8 || !/^[0-9]{8}$/.test(deliveryNumber)) {
    throw new Error('Invalid SAP Delivery Number.');
  }
}
export function deliveryScanNote(deliveryNumber: string): string {
  validNumber(deliveryNumber);
  return `SAP Delivery Number ${deliveryNumber} scanned and saved to this visit; PDF attachment is separate and optional.`;
}
export function deliveryManualNote(deliveryNumber: string): string {
  validNumber(deliveryNumber);
  return `SAP Delivery Number ${deliveryNumber} manually entered and saved to this visit; PDF attachment is separate and optional.`;
}
interface ScanEventFact {
  id: number;
  truckVisitId: number;
  eventType: string;
  notes?: string | null;
}
export function scannedDeliveryNumbers(visitId: number, events: readonly ScanEventFact[]): string[] {
  const numbers = new Set<string>();
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    if (event.truckVisitId !== visitId || typeof event.notes !== 'string') continue;
    const pattern = event.eventType === DELIVERY_SCAN_EVENT ? NOTE_PATTERN :
      event.eventType === DELIVERY_MANUAL_EVENT ? MANUAL_NOTE_PATTERN : null;
    const match = pattern?.exec(event.notes);
    if (match && match[0] === event.notes) numbers.add(match[1]);
  }
  return [...numbers];
}
