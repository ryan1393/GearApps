/**
 * The blade operations shown as tabs on the operations station, in workflow order.
 * `flowStep` numbers the main tray journey; Internal Movement can happen at any point, so it has none.
 * `instruction` is the one-line guide shown under the tabs.
 */
export const BLADE_OPERATIONS = [
  { key: 'intake', label: 'Blade Intake', icon: 'intake', flowStep: 1, instruction: 'Scan a tray to create or top up its blades. Grinding is recorded on the next tab.' },
  { key: 'grinding', label: 'Grinding', icon: 'grinding', flowStep: 2, instruction: 'Scan your grinder once, then each tray. Scrap defaults to zero; a full set goes into an empty coater container (or stays in the tray) at COATER-STAGING, or on a CGRR / CGRP rough shelf bin.' },
  { key: 'load-container', label: 'Load Container', icon: 'container', flowStep: 3, instruction: 'Scan an empty container, then the full ground tray: its set moves into the container and the tray empties. Loading does not send anything.' },
  { key: 'coater-shipments', label: 'Coater Shipments', icon: 'ship', flowStep: 4, instruction: 'Add packed containers to a shipment, review, print the packing slip, then send.' },
  { key: 'receive-container', label: 'Receive From Coater', icon: 'receive', flowStep: 5, instruction: 'Scan the returned container, then an empty tray for its set and the finished shelf: CGFR for RING, CGFP for PINION.' },
  { key: 'internal-movement', label: 'Internal Movement', icon: 'move', flowStep: null, instruction: 'Scan a tray, then the location it is moving to.' },
] as const;

export type BladeOperationKey = (typeof BLADE_OPERATIONS)[number]['key'];

export function isBladeOperation(value: unknown): value is BladeOperationKey {
  return BLADE_OPERATIONS.some((operation) => operation.key === value);
}

/** What the station needs from each embedded operation page. */
export interface StationOperation {
  /** Work is under way that leaving the tab would interrupt (a selected tray, container or shipment). */
  readonly inProgress: boolean;
  /** The tab was opened again: refresh lists that may have changed meanwhile, without touching work in progress. */
  stationActivated(): void;
}
