import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadEnv } from './env.mjs';
import { assertSchemaCurrent } from './migrate.mjs';

loadEnv();
const { Client } = pg;
const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) return null;
  return args[index + 1];
};
const allowed = new Set(['--agent-id', '--name', '--rotate']);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  if (arg !== '--rotate') index += 1;
}
const agentId = valueFor('--agent-id');
const displayName = valueFor('--name');
const rotate = args.includes('--rotate');
if (!agentId || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(agentId)) {
  throw new Error('--agent-id is required and must use 3-120 letters, numbers, dots, underscores, or hyphens.');
}
if (!displayName || !displayName.trim() || displayName.trim().length > 160) {
  throw new Error('--name is required and must be 1-160 characters.');
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
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [agentId]);
  await client.query(
    `INSERT INTO print_agents(agent_id, display_name)
     VALUES ($1, $2)
     ON CONFLICT (agent_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
    [agentId, displayName.trim()],
  );
  if (rotate) {
    await client.query(
      `UPDATE print_agent_credentials
          SET active = FALSE, revoked_at = NOW()
        WHERE agent_id = $1 AND active = TRUE`,
      [agentId],
    );
  }
  await client.query(
    `INSERT INTO print_agent_credentials(key_id, agent_id, secret_sha256, scopes)
     VALUES (
       $1,
       $2,
       $3,
       '["heartbeat", "documents:upload"]'::jsonb
         || '["print-jobs:poll", "documents:download", "print-jobs:report"]'::jsonb
     )`,
    [keyId, agentId, secretSha256],
  );
  await client.query('COMMIT');
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
  throw error;
} finally {
  await client.end();
}

console.log('[PASS] Print Agent credential created.');
console.log(`Agent ID: ${agentId}`);
console.log(`Key ID: ${keyId}`);
console.log(`Bearer token (shown once): tlpa_${keyId}_${secret}`);
console.log('Store this token only on the dedicated Windows Print PC.');
