/** a durable visit scan receipt, independent of any PDF attachment. */
export interface DockDeliveryScanReceipt {
  visitId: number;
  eventId: number;
  deliveryNumber: string;
  savedAt: string;
  alreadySaved: boolean;
  /** Original saved entry method; omitted by older scanner-only servers. */
  entryMethod?: 'SCAN' | 'MANUAL';
}
