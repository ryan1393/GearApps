import type { Readable } from 'node:stream';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const CLAIM_TOKEN_SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const EXPIRED_LEASE_ERROR =
  'Print Agent lease expired after job delivery; the physical print outcome is unknown. Guard retry is required.';
export const SYSTEM_CHECK_IN_ACTOR = 'TRUCK_LOG_CHECK_IN';
export const SYSTEM_GUARD_ACTOR = 'TRUCK_LOG_GUARD_UI';

export type DriverPrintItemStatus =
  | 'PENDING_CONFIRMATION'
  | 'QUEUED'
  | 'LEASED'
  | 'PRINTED'
  | 'FAILED';

export type DriverPrintEventType =
  | 'DRIVER_PRINT_PACKAGE_REQUESTED'
  | 'DOCK_ASSIGNMENT_PRINTED'
  | 'DOCK_ASSIGNMENT_PRINT_FAILED'
  | 'DOCK_ASSIGNMENT_PRINT_RETRIED'
  | 'RXO_DOCUMENT_PRINTED'
  | 'RXO_DOCUMENT_PRINT_FAILED'
  | 'RXO_DOCUMENT_PRINT_RETRIED'
  | 'RXO_DOCUMENT_REPRINTED';

/** Visit-history events also record a Print Agent result that arrived late. */
export type DriverPrintVisitEventType =
  | DriverPrintEventType
  | 'RXO_DOCUMENT_PRINTED_LATE_RESULT'
  | 'RXO_DOCUMENT_PRINT_FAILED_LATE_RESULT';

export interface DriverPrintPackageSummary {
  automaticDockAssignment?: boolean;
  packageId: string;
  status: string;
  frozenRxoDocumentId: number | null;
  frozenRxoDocumentVersion: number | null;
  frozenRxoDocumentFileName: string | null;
  items: Array<{
    id: string;
    itemType: 'DOCK_ASSIGNMENT' | 'RXO_DOCUMENT';
    status: DriverPrintItemStatus;
    error: string | null;
    printedAt: string | null;
    recoverable?: boolean;
    cancelled?: boolean;
    replacementPackageId?: string | null;
  }>;
}

export interface PersistedAgentPrintJob {
  itemId: string;
  packageId: string;
  attemptNumber: number;
  route: string;
  printer: string;
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  leaseExpiresAt: string;
  downloadUrl: string;
}

export interface AgentPrintJob extends PersistedAgentPrintJob {
  claimToken: string;
}

export interface PersistedAgentClaimResponse {
  job: PersistedAgentPrintJob | null;
}

export interface AgentClaimResponse {
  job: AgentPrintJob | null;
}

export interface DriverPrintConfiguration {
  agentId: string | null;
  route: string | null;
  printer: string | null;
  valid: boolean;
  error: string | null;
}

export interface AgentAvailability extends DriverPrintConfiguration {
  available: boolean;
  agentExists: boolean;
}

export interface DocumentSnapshot {
  id: number;
  truckVisitId: number;
  fileName: string;
  relativePath: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
  rxoSiteKey: string;
  rxoShipmentId: string;
  rxoDirection: string;
  documentVersion: number;
}

export interface DriverEventInput {
  eventType: DriverPrintEventType;
  actorType: 'HUMAN' | 'PRINT_AGENT' | 'SYSTEM';
  actorId: string;
  actorKeyId?: string | null;
  truckVisitId: number;
  packageId: string;
  itemId?: string | null;
  document?: DocumentSnapshot | null;
  route?: string | null;
  printer?: string | null;
  error?: string | null;
  details?: Record<string, unknown>;
}

export interface PrintAgentDocumentDownload {
  absolutePath: string;
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  stream: Readable;
}
