import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  SapDocumentFileValidationError,
  VerifiedRxoPdfError,
} from '@truck-log/server/infrastructure/sap-documents';

/** Constants and pure helpers shared by the automatic Driver Print modules. */
export const SHA = /^[a-f0-9]{64}$/;
export const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const MAX_PDF = 25 * 1024 * 1024;
export const UNCERTAIN =
  'Print lease expired. Physical outcome is uncertain; inspect the printer before an explicit retry. No automatic reprint.';
export type Queryable = Pick<EntityManager, 'query'>;
export interface FrozenJob {
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
export function required(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ConflictException(message);
}
export function text(x: unknown): string {
  return String(x ?? '').trim();
}
/** Normalizes the documented PostgreSQL TypeORM UPDATE [rows, count] shape. */
export function oneUpdated(result: unknown, id: string): void {
  const rows = updateRows(result);
  required(
    Array.isArray(rows) && rows.length === 1 && text(rows[0]?.id) === id,
    'The locked automatic print row was not updated exactly once.',
  );
}
export function iso(x: unknown): string | null {
  if (!x) return null;
  const d = new Date(String(x));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
/** Keeps this route's original Print Agent error messages for shared-reader failures. */
export function automaticRxoReadError(error: unknown): unknown {
  if (error instanceof SapDocumentFileValidationError) {
    return new ConflictException('Invalid RXO document path.');
  }
  if (!(error instanceof VerifiedRxoPdfError)) return error;
  switch (error.reason) {
    case 'NAMESPACE_INVALID':
    case 'PATH_OUTSIDE_NAMESPACE':
      return new ConflictException('RXO file escaped its immutable namespace.');
    case 'SIZE_OR_TYPE_MISMATCH':
      return new ConflictException('RXO stored size does not match.');
    case 'OPENED_PATH_CHANGED':
      return new ConflictException('RXO opened path changed.');
    default:
      return new ConflictException('Frozen PDF integrity validation failed.');
  }
}
export function key(k: unknown): asserts k is string {
  if (typeof k !== 'string' || !KEY.test(k))
    throw new BadRequestException('A valid X-Idempotency-Key is required.');
}
export function updateRows<T = { id: string }>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0]) && Number.isInteger(result[1])) {
    required(result[1] === result[0].length, 'Inconsistent PostgreSQL update row count.');
    return result[0] as T[];
  }
  return result as T[];
}
