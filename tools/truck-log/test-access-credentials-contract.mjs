import fs from 'node:fs';
import { readSchemaSql, schemaIncludes } from './migration-sql.mjs';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = readSchemaSql();
const credentialEntity = read(
  'libs/truck-log/server/data-access/src/lib/entities/truck-log-access-credential.entity.ts',
);
const idempotencyEntity = read(
  'libs/truck-log/server/data-access/src/lib/entities/truck-log-access-idempotency.entity.ts',
);
const auth = read('libs/truck-log/server/auth/access/src/lib/truck-log-access.ts');
// The constant-time digest comparison lives in the shared data-access helper the guard imports.
const guard = read('libs/truck-log/server/auth/access/src/lib/truck-log-access.guard.ts')
  + read('libs/truck-log/server/data-access/src/lib/support/request-integrity.ts');
const moduleSource = read('libs/truck-log/server/auth/access/src/lib/truck-log-access.module.ts');
const publicApi = read('libs/truck-log/server/auth/access/src/index.ts');
const serverModule = read('libs/truck-log/server/core/src/lib/truck-log-server.module.ts');
const provision = read('tools/truck-log/provision-access-credential.mjs');
const databaseTooling = read('tools/truck-log/database-tooling.mjs');

let checks = 0;
function must(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
}

must(
  schemaIncludes('CREATE TABLE IF NOT EXISTS truck_log_access_credentials'),
  'Migrations create scoped access credentials',
);
must(
  schemaIncludes('CREATE TABLE IF NOT EXISTS truck_log_access_idempotency'),
  'Migrations create human-action idempotency storage',
);
for (const scope of ['rxo-documents:write', 'rxo-documents:reprint']) {
  must(schemaIncludes(scope), `Migration allowlists ${scope}`);
  must(credentialEntity.includes(scope), `Credential entity allowlists ${scope}`);
}
for (const field of [
  'secret_sha256', 'last_used_at', 'expires_at', 'revoked_at',
  'request_sha256', 'response_status', 'response_body',
]) {
  must(schemaIncludes(field), `Migration contains protected field ${field}`);
}
must(
  !/\b(secret|token)\s+(?:TEXT|VARCHAR|CHARACTER)/i.test(migration),
  'Migration has no raw token or raw secret column',
);
must(
  schemaIncludes('PRIMARY KEY (key_id, idempotency_key)'),
  'Idempotency records are unique per credential and key',
);
must(
  schemaIncludes("NOW() + INTERVAL '7 days'"),
  'Idempotency records have a seven-day default expiry',
);
must(
  idempotencyEntity.includes("@Entity({ name: 'truck_log_access_idempotency' })"),
  'TypeORM maps the access idempotency table',
);
must(
  guard.includes("/^tloa_([0-9a-f]{16})_([0-9a-f]{64})$/"),
  'Guard accepts only the exact scoped access token format',
);
must(guard.includes('timingSafeEqual'), 'Guard compares credential digests in constant time');
must(guard.includes('DUMMY_DIGEST'), 'Guard performs a dummy digest comparison for unknown keys');
must(guard.includes('credential.revokedAt !== null'), 'Guard rejects revoked credentials');
must(guard.includes('credential.expiresAt <= now'), 'Guard rejects expired credentials');
must(guard.includes('requiredScopes.some'), 'Guard enforces endpoint scope metadata');
must(guard.includes('lastUsedAt: now'), 'Guard records successful credential use');
must(
  guard.includes('subjectId: credential.subjectId') &&
    guard.includes('displayName: credential.displayName'),
  'Authenticated actor identity derives from the credential record',
);
must(
  auth.includes('truckLogPrincipal?: AuthenticatedTruckLogPrincipal'),
  'Request type carries only a server-authenticated principal',
);
must(
  moduleSource.includes('TruckLogAccessCredential') &&
    moduleSource.includes('TruckLogAccessIdempotency') &&
    moduleSource.includes('TruckLogAccessGuard'),
  'Access module registers credential, idempotency, and guard providers',
);
must(
  serverModule.includes('TruckLogAccessModule'),
  'Truck Log server loads the scoped access module',
);
must(
  publicApi.includes('RequireTruckLogAccess as TruckLogAccessScope'),
  'Access public API preserves the agreed TruckLogAccessScope decorator alias',
);
must(
  provision.includes('randomBytes(32)') &&
    provision.includes("createHash('sha256')") &&
    provision.includes('Bearer token (shown once)'),
  'Provisioning creates a 256-bit secret, stores its digest, and shows the token once',
);
must(
  provision.includes("if (!requestedScopes.length") &&
    provision.includes('ALLOWED_SCOPES'),
  'Provisioning requires explicit allowlisted least-privilege scopes',
);
console.log(`[PASS] Truck Log access credential contract complete: ${checks} checks.`);
