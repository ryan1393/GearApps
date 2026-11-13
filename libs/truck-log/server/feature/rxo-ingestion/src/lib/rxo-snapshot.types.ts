/** Row and boundary shapes of the verified RXO latest snapshot. */

export type Direction = 'INBOUND' | 'OUTBOUND';
export type DatasetKey = 'orders' | 'shipments' | 'freight-on-the-move';
export type Row = Record<string, unknown>;
export type BoundaryDataset = { pageKey: DatasetKey; direction: Direction; relativePath: string; sha256?: string };
export type Boundary = {
  contractVersion: number;
  sourceBatchId: string;
  sourceManifestVersion?: string;
  sourceCompletedAt?: string;
  datasetCount: number;
  datasets: BoundaryDataset[];
  site?: { key?: string; name?: string; requiredIdentifiers?: string[] };
  directionRule?: { Origin?: string; Destination?: string };
  postgresImported?: boolean;
  postgresImportedAt?: string;
  postgresImportSummary?: Record<string, unknown>;
};

export type ParsedOrder = {
  orderNumber: string;
  direction: Direction;
  shipmentId: string | null;
  status: string | null;
  originName: string | null;
  originAddress: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  pickupAt: Date | null;
  deliveryAt: Date | null;
  customerOrderNumber: string | null;
  trackingNumber: string | null;
  rawRow: Record<string, string>;
};

export type ParsedShipment = {
  shipmentId: string;
  direction: Direction;
  status: string | null;
  mode: string | null;
  carrierName: string | null;
  orderCount: number | null;
  orderNumbers: string[];
  stopCount: number | null;
  firstStopName: string | null;
  firstStopAddress: string | null;
  lastStopName: string | null;
  lastStopAddress: string | null;
  plantScheduledAt: Date | null;
  proNumber: string | null;
  trailerNumber: string | null;
  pieces: string | null;
  totalWeight: string | null;
  volume: string | null;
  hazardous: boolean | null;
  rawRow: Record<string, string>;
};

export type ParsedFreight = {
  shipmentId: string;
  direction: Direction;
  status: string | null;
  etaStatus: string | null;
  mode: string | null;
  carrierName: string | null;
  firstStopAddress: string | null;
  lastStopAddress: string | null;
  pickupEstimatedArrivalRaw: string | null;
  pickupAppointmentArrivalRaw: string | null;
  deliveryEstimatedArrivalRaw: string | null;
  deliveryAppointmentArrivalRaw: string | null;
  plantScheduledAt: Date | null;
  proNumber: string | null;
  trailerNumber: string | null;
  rawRow: Record<string, string>;
};
