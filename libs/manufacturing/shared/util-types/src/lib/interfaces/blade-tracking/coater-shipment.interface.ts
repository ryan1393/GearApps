export interface CoaterShipmentBlade {
  id: string;
  serial: string;
  status: string;
  cycle: number;
}
export interface CoaterShipmentTray {
  /**
   * SET: one complete set moved out of its tray into the container (id is the set; serial is
   * the tray it came from). TRAY, or absent in older manifests: a whole tray packed in the container.
   */
  kind?: 'TRAY' | 'SET';
  id: string;
  assignment_id: string;
  serial: string;
  summary: string;
  part_type: string;
  count: number;
  required: number | null;
  /** Where it was packed from or waits: a rough shelf bin or COATER-STAGING. */
  rough_shelf: string;
  blades: CoaterShipmentBlade[];
}
export interface CoaterShipmentContainer {
  id: string;
  serial: string;
  trays: CoaterShipmentTray[];
  issues: string[];
}
export interface CoaterManifest {
  containers: CoaterShipmentContainer[];
  totals: { containers: number; trays: number; blades: number };
  summary: Array<{ summary: string; part_type: string; trays: number; blades: number }>;
  issues: string[];
}
export interface CoaterShipment {
  id: string;
  number: string;
  status: 'DRAFT' | 'DISPATCHED' | 'CANCELED';
  revision: number;
  destination: string;
  notes: string;
  created_at: string;
  created_by: string;
  dispatched_at: string | null;
  dispatched_by: string | null;
  manifest: CoaterManifest;
  reviewed: boolean;
  print_requested: boolean;
  changed: boolean;
  rpa?: CoaterRpaState;
  events: Array<{ kind: string; revision: number; at: string; actor: string; detail: string }>;
}

export interface CoaterRpaState {
  configured: boolean;
  coater_name: string | null;
  default_po: string | null;
  email_enabled: boolean;
  request: {
    number: number;
    po: string;
    email_status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
    recipient_count: number;
  } | null;
}
export interface CoaterAvailableContainer {
  id: string;
  serial: string;
  trays: number;
  blades: number;
  summary: CoaterManifest['summary'];
}
export interface CoaterShipmentList {
  rows: Array<{ id: string; number: string; status: string; revision: number; destination: string; created_at: string; totals: CoaterManifest['totals'] }>;
  total: number;
  page: number;
  page_size: number;
}
export interface CoaterPackingSlip {
  shipment: CoaterShipment;
  reprint: boolean;
  requested_at: string;
  requested_by: string;
}
