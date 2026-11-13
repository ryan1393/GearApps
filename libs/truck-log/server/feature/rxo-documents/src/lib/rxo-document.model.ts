import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SapDocumentFileValidationError } from '@truck-log/server/infrastructure/sap-documents';
import type { RxoShipmentIdentity } from '@truck-log/server/domain/rxo';

/** Shared constants, row shapes and pure helpers for RXO driver documents. */

export const RXO_DRIVER_DOCUMENT_TYPE = 'RXO_DRIVER_DOCUMENT';
export const MATERIALS_UPLOAD_SOURCE = 'MATERIALS_UPLOAD';
export const RXO_CHECK_IN_RACE_GRACE_MS = 10 * 60 * 1000;
export const DEFAULT_HISTORY_LIMIT = 25;
export const MAX_HISTORY_LIMIT = 100;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export type RxoDriverDocumentStatus =
  | 'NO_DOCUMENT'
  | 'READY'
  | 'PRINTING'
  | 'PRINTED'
  | 'PRINT_FAILED';


export interface RxoDocumentRow {
  id: number | string;
  truck_visit_id: number | string | null;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | string | null;
  sha256: string | null;
  scanned_at: Date | string;
  rxo_document_version: number | string;
  rxo_is_active: boolean;
  uploaded_by_key_id: string;
  uploader_subject_id?: string | null;
  uploader_display_name?: string | null;
  association_status: string;
  association_method: string | null;
  association_reason: string | null;
  review_status: string;
  review_reason: string | null;
  supersedes_document_id: number | string | null;
  superseded_at: Date | string | null;
  latest_print_status?: string | null;
  latest_print_error?: string | null;
  latest_print_route?: string | null;
  latest_print_printer?: string | null;
  latest_print_agent_id?: string | null;
  printed_at?: Date | string | null;
  history_total?: number | string;
  active_total?: number | string;
}

export interface ActiveDocumentRow extends RxoDocumentRow {
  stored_file_name: string;
  relative_path: string;
}

export interface CredentialRow {
  key_id: string;
  subject_id: string;
  display_name: string;
}

export interface LinkedVisitRow {
  id: number | string;
  eligible_for_initial_package: boolean;
  manual_printing?: boolean;
}

export interface Queryable {
  query(query: string, parameters?: unknown[]): Promise<any[]>;
}

export function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

export function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizedUploadMimeType(value: string | undefined): string {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

export function mapStorageError(error: unknown): never {
  if (!(error instanceof SapDocumentFileValidationError)) throw error;
  if (error.code === 'FILE_TOO_LARGE') {
    throw new PayloadTooLargeException(error.message);
  }
  if (error.code === 'INVALID_MIME_TYPE') {
    throw new UnsupportedMediaTypeException(error.message);
  }
  if (error.code === 'INVALID_PDF_HEADER') {
    throw new UnprocessableEntityException(error.message);
  }
  throw new BadRequestException(error.message);
}

export function printStatusFor(row: RxoDocumentRow | undefined): RxoDriverDocumentStatus {
  if (!row) return 'NO_DOCUMENT';
  if (row.printed_at) return 'PRINTED';
  if (row.latest_print_status === 'FAILED') return 'PRINT_FAILED';
  if (
    row.latest_print_status === 'PENDING_CONFIRMATION'
    || row.latest_print_status === 'QUEUED'
    || row.latest_print_status === 'LEASED'
  ) {
    return 'PRINTING';
  }
  return 'READY';
}

export function normalizeIdentity(
  siteKeyValue: string,
  directionValue: string,
  shipmentIdValue: string,
): RxoShipmentIdentity {
  const siteKey = String(siteKeyValue || '').trim().toLowerCase();
  const direction = String(directionValue || '').trim().toUpperCase();
  const shipmentId = String(shipmentIdValue || '').trim().toUpperCase();

  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(siteKey)) {
    throw new BadRequestException('siteKey must be a valid RXO site identifier.');
  }
  if (direction !== 'INBOUND' && direction !== 'OUTBOUND') {
    throw new BadRequestException('direction must be INBOUND or OUTBOUND.');
  }
  if (
    !shipmentId
    || shipmentId.length > 120
    || /[\u0000-\u001f\u007f/\\]/.test(shipmentId)
  ) {
    throw new BadRequestException('shipmentId must be a valid RXO shipment identifier.');
  }

  return {
    siteKey,
    direction,
    shipmentId,
  };
}
