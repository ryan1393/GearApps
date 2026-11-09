/** visit-scoped scan selection. Tokens are short-lived, never stored in URLs. */
export interface DockScanCandidate {
  documentId: number;
  deliveryNumber: string;
  fileName: string;
  fileSizeBytes: number;
  capturedAt: string;
  sha256: string;
  alreadyAttached: boolean;
  selectionToken: string;
}
export interface DockScanLookup {
  visitId: number;
  deliveryNumber: string;
  currentDocument: { id: number; fileName: string; deliveryNumber: string | null } | null;
  candidates: DockScanCandidate[];
  message: string;
}
