/** TV projection: read-only and deliberately excludes driver PII, documents and tokens. */
export interface TvDockRecord {
  id: number;
  code: string;
  description: string;
  active: boolean;
  sortOrder: number;
}
export interface TvVisitRecord {
  id: number;
  visitReference: string;
  loadNumber: string;
  carrierName: string;
  trailerId: string;
  direction: string;
  dockCode: string;
  status: string;
  guardCheckInAt: string | null;
  dockAssignedAt: string | null;
  dockCompletedAt: string | null;
  guardCheckOutAt: string | null;
  packingSlipAttached: boolean;
}
export interface TvBoardSnapshot {
  schema: 'truck-log-tv-v1';
  generatedAt: string;
  siteName: string;
  warningMinutes: number;
  criticalMinutes: number;
  docks: TvDockRecord[];
  visits: TvVisitRecord[];
}
