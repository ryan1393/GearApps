import type { AuthenticatedTruckLogPrincipal } from '@truck-log/server/auth/access';

// An audit identity, NOT a credential. The database row is always inactive and
// revoked with an unusable hash. It can never authenticate through either guard.
// Object identity selects this internal path; request fields cannot select it.
export const RXO_BROWSER_UPLOAD_PRINCIPAL: AuthenticatedTruckLogPrincipal = Object.freeze({
  keyId: '476f06372342c0cb',
  subjectId: 'rxo.browser-upload',
  displayName: 'Materials browser (no sign-in)',
  scopes: ['rxo-documents:write' as const],
});

interface AuditActor { key_id: string; subject_id: string; display_name: string; }
interface Queryable { query(sql: string, parameters: unknown[]): Promise<AuditActor[]>; }

/** Reuse the existing FK/audit model without changing migrations or old users. */
export async function ensureRxoBrowserUploadActor(manager: Queryable): Promise<AuditActor> {
  const principal = RXO_BROWSER_UPLOAD_PRINCIPAL;
  const rows = await manager.query(
    `INSERT INTO truck_log_access_credentials (
       key_id, subject_id, display_name, secret_sha256, scopes,
       active, revoked_at, last_used_at
     ) VALUES ($1, $2, $3, $4, '["rxo-documents:write"]'::jsonb, FALSE, NOW(), NOW())
     ON CONFLICT (key_id) DO UPDATE SET last_used_at = NOW()
       WHERE truck_log_access_credentials.subject_id = $2
         AND truck_log_access_credentials.display_name = $3
         AND truck_log_access_credentials.secret_sha256 = $4
         AND truck_log_access_credentials.scopes = '["rxo-documents:write"]'::jsonb
         AND truck_log_access_credentials.active = FALSE
         AND truck_log_access_credentials.revoked_at IS NOT NULL
         AND truck_log_access_credentials.expires_at IS NULL
     RETURNING key_id, subject_id, display_name`,
    [principal.keyId, principal.subjectId, principal.displayName, '0'.repeat(64)],
  );
  if (!rows[0]) {
    throw new Error('The reserved RXO browser-upload audit identity conflicts with an existing record.');
  }
  return rows[0];
}
