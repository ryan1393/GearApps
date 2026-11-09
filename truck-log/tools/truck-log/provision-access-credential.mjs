import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadEnv } from './env.mjs';
import { assertSchemaCurrent } from './migrate.mjs';

loadEnv();
const { Client } = pg;
const ALLOWED_SCOPES = new Set([
  'rxo-documents:write',
  'rxo-documents:reprint',
]);
const args = process.argv.slice(2);
const singleValue = (flag) => {
  const positions = args.flatMap((arg, index) => arg === flag ? [index] : []);
  if (positions.length > 1) throw new Error(`${flag} may be provided only once.`);
  const index = positions[0];
  if (index === undefined || !args[index + 1] || args[index + 1].startsWith('--')) return null;
  return args[index + 1];
};
const values = (flag) => args.flatMap((arg, index) => {
  if (arg !== flag) return [];
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return [args[index + 1]];
});
const valueFlags = new Set(['--subject-id', '--name', '--scope', '--expires-days']);
const booleanFlags = new Set(['--rotate']);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (booleanFlags.has(arg)) continue;
  if (!valueFlags.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${arg} requires a value.`);
  }
  index += 1;
}

const subjectId = singleValue('--subject-id');
const displayName = singleValue('--name');
const rotate = args.includes('--rotate');
const requestedScopes = [...new Set(values('--scope'))].sort();
const expiresDaysText = singleValue('--expires-days');

if (!subjectId || !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$/.test(subjectId)) {
  throw new Error('--subject-id is required and must use 1-120 letters, numbers, dots, underscores, @, or hyphens.');
}
if (!displayName || !displayName.trim() || displayName.trim().length > 160) {
  throw new Error('--name is required and must be 1-160 characters.');
}
if (!requestedScopes.length || requestedScopes.some((scope) => !ALLOWED_SCOPES.has(scope))) {
  throw new Error(
    '--scope is required and may be repeated with rxo-documents:write and/or rxo-documents:reprint.',
  );
}

let expiresAt = null;
if (expiresDaysText !== null) {
  const expiresDays = Number(expiresDaysText);
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 3650) {
    throw new Error('--expires-days must be an integer from 1 through 3650.');
  }
  expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
}

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};
const client = new Client({
  host: required('TRUCK_LOG_DATABASE_HOST'),
  port: Number(required('TRUCK_LOG_DATABASE_PORT')),
  user: required('TRUCK_LOG_DATABASE_USERNAME'),
  password: required('TRUCK_LOG_DATABASE_PASSWORD'),
  database: required('TRUCK_LOG_DATABASE_NAME'),
  ssl: String(process.env.TRUCK_LOG_DATABASE_SSL ?? 'false').toLowerCase() === 'true'
    ? { rejectUnauthorized: false }
    : false,
});
const keyId = randomBytes(8).toString('hex');
const secret = randomBytes(32).toString('hex');
const secretSha256 = createHash('sha256').update(secret, 'utf8').digest('hex');

await client.connect();
try {
  await assertSchemaCurrent(client);
  await client.query('BEGIN');
  await client.query("SET LOCAL search_path = public, pg_catalog");
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`truck-log-access:${subjectId}`],
  );
  if (rotate) {
    await client.query(
      `UPDATE truck_log_access_credentials
          SET active = FALSE, revoked_at = NOW()
        WHERE subject_id = $1 AND active = TRUE`,
      [subjectId],
    );
  }
  await client.query(
    `INSERT INTO truck_log_access_credentials(
       key_id, subject_id, display_name, secret_sha256, scopes, expires_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      keyId,
      subjectId,
      displayName.trim(),
      secretSha256,
      JSON.stringify(requestedScopes),
      expiresAt,
    ],
  );
  await client.query('COMMIT');
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
  throw error;
} finally {
  await client.end();
}

console.log('[PASS] Scoped Truck Log access credential created.');
console.log(`Subject ID: ${subjectId}`);
console.log(`Display name: ${displayName.trim()}`);
console.log(`Scopes: ${requestedScopes.join(', ')}`);
console.log(`Expires: ${expiresAt?.toISOString() ?? 'No automatic expiry'}`);
console.log(`Key ID: ${keyId}`);
console.log(`Bearer token (shown once): tloa_${keyId}_${secret}`);
console.log('Store this token securely. It cannot be recovered from Truck Log.');
