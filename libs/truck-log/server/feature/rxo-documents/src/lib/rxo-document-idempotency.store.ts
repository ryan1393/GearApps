import { returnedRows } from '@truck-log/server/data-access';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import type { CredentialRow } from './rxo-document.model';

/**
 * Transaction-scoped helpers for authenticated, idempotent RXO uploads:
 * advisory locks, credential revalidation and the stored-response replay table.
 */
export async function advisoryLock(manager: EntityManager, key: string): Promise<void> {
  await manager.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [key],
  );
}

export async function revalidateRxoUploadCredential(
  manager: EntityManager,
  keyId: string,
): Promise<CredentialRow> {
  const rows = returnedRows(await manager.query(
    `UPDATE truck_log_access_credentials
        SET last_used_at = NOW()
      WHERE key_id = $1
        AND active = TRUE
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND scopes @> '["rxo-documents:write"]'::jsonb
      RETURNING key_id, subject_id, display_name`,
    [keyId],
  )) as CredentialRow[];
  if (!rows[0]) {
    throw new UnauthorizedException(
      'This Truck Log access credential is no longer authorized to upload RXO documents.',
    );
  }
  return rows[0];
}

export async function priorIdempotentResponse(
  manager: EntityManager,
  keyId: string,
  idempotencyKey: string,
  requestSha256: string,
): Promise<Record<string, unknown> | null> {
  await manager.query(
    `DELETE FROM truck_log_access_idempotency
      WHERE key_id = $1
        AND idempotency_key = $2
        AND expires_at <= NOW()`,
    [keyId, idempotencyKey],
  );
  const rows = await manager.query(
    `SELECT request_sha256, response_body
       FROM truck_log_access_idempotency
      WHERE key_id = $1 AND idempotency_key = $2`,
    [keyId, idempotencyKey],
  ) as Array<{
    request_sha256: string;
    response_body: Record<string, unknown> | string;
  }>;
  if (!rows[0]) return null;
  if (rows[0].request_sha256 !== requestSha256) {
    throw new ConflictException(
      'This X-Idempotency-Key was already used with a different request.',
    );
  }
  return typeof rows[0].response_body === 'string'
    ? JSON.parse(rows[0].response_body) as Record<string, unknown>
    : rows[0].response_body;
}

export async function rememberIdempotentResponse(
  manager: EntityManager,
  keyId: string,
  idempotencyKey: string,
  requestSha256: string,
  body: Record<string, unknown>,
): Promise<void> {
  await manager.query(
    `INSERT INTO truck_log_access_idempotency(
       key_id, idempotency_key, request_sha256, response_status, response_body
     ) VALUES ($1, $2, $3, 200, $4::jsonb)`,
    [keyId, idempotencyKey, requestSha256, JSON.stringify(body)],
  );
}
