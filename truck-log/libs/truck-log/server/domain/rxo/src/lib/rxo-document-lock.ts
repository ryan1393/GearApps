export interface RxoShipmentIdentity {
  siteKey: string;
  direction: 'INBOUND' | 'OUTBOUND';
  shipmentId: string;
}

/**
 * Shared by upload/replacement, visit association, and Driver Print Package
 * creation so each operation observes one stable RXO document version.
 */
export function rxoShipmentLockKey(identity: RxoShipmentIdentity): string {
  return [
    'truck-log',
    'rxo-shipment',
    identity.siteKey,
    identity.direction,
    identity.shipmentId,
  ].join(':');
}
