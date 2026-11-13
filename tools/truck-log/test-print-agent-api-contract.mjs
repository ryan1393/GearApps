import fs from 'node:fs';
import path from 'node:path';
import { readSchemaSql, schemaIncludes } from './migration-sql.mjs';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
let passed = 0;
function must(condition, message) {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  passed += 1;
}
function has(source, marker, message) {
  must(source.includes(marker), message);
}

const migration = readSchemaSql();
for (const table of ['print_agents', 'print_agent_credentials', 'print_agent_idempotency']) {
  must(schemaIncludes(`CREATE TABLE IF NOT EXISTS ${table}`), `migration creates ${table}`);
}
for (const marker of [
  'secret_sha256 VARCHAR(64) NOT NULL',
  'configured_routes JSONB NOT NULL',
  'last_successful_capture_at TIMESTAMPTZ',
  'last_successful_print_at TIMESTAMPTZ',
  'last_error TEXT',
  'PRIMARY KEY (agent_id, idempotency_key)',
  "expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')",
  'fk_print_agent_credentials_agent',
  'fk_print_agent_idempotency_agent',
]) must(schemaIncludes(marker), `migration preserves ${marker}`);
must(!/secret\s+(?:varchar|text)/i.test(migration), 'migration never stores a raw Print Agent secret');

// The constant-time digest comparison lives in the shared data-access helper the guard imports.
const guard = read('libs/truck-log/server/auth/print-agent/src/lib/print-agent-auth.guard.ts')
  + read('libs/truck-log/server/data-access/src/lib/support/request-integrity.ts');
for (const marker of [
  'TOKEN_PATTERN', 'timingSafeEqual', "createHash('sha256')", 'active: true',
  '!credential.agent?.enabled', 'credential.scopes.includes(requiredScope)',
  'Valid Print Agent credentials are required.',
  "credential?.secretSha256 ?? '0'.repeat(64)",
]) has(guard, marker, `authentication guard includes ${marker}`);
must(!guard.includes('console.log'), 'authentication guard never logs credentials');

const controller = read('libs/truck-log/server/feature/print-agents/src/lib/print-agents.controller.ts');
for (const marker of [
  "@Controller('print-agents')", "@Post('heartbeat')", '@UseGuards(PrintAgentAuthGuard)',
  "@PrintAgentScope('heartbeat')", "@Headers('x-idempotency-key')", "@Get('status')",
]) has(controller, marker, `Print Agent controller includes ${marker}`);
must(!controller.includes("@Post('upload')"), 'Phase 2 does not expose PDF ingestion before Phase 3 validation');

const service = read('libs/truck-log/server/feature/print-agents/src/lib/print-agents.service.ts');
for (const marker of [
  'IDEMPOTENCY_KEY_PATTERN', 'canonicalJson', 'pg_advisory_xact_lock',
  'request_sha256 !== requestSha256', 'different heartbeat',
  'GREATEST(last_successful_capture_at', 'GREATEST(last_successful_print_at',
  "THEN 'DISABLED'", "THEN 'ONLINE'", "ELSE 'OFFLINE'",
  'TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS', 'LIMIT 5000',
  'expires_at < NOW()', 'last_used_at',
  'RETURNING key_id', 'credential is no longer active',
]) has(service, marker, `heartbeat/status service includes ${marker}`);
must(service.indexOf('pg_advisory_xact_lock') < service.indexOf('SELECT request_sha256'), 'concurrent retries lock before replay lookup');
must(service.indexOf('INSERT INTO print_agent_idempotency') > service.indexOf('UPDATE print_agents'), 'idempotency response is stored in the same transaction after heartbeat update');

const dto = read('libs/truck-log/server/feature/print-agents/src/lib/dto/print-agent-heartbeat.dto.ts');
for (const marker of ['@ArrayMaxSize(50)', '@MaxLength(2000)', '@IsISO8601', '@ValidateNested']) {
  has(dto, marker, `heartbeat DTO bounds ${marker}`);
}

const provision = read('tools/truck-log/provision-print-agent.mjs');
for (const marker of [
  'randomBytes(32)', "createHash('sha256')", 'secret_sha256', '--rotate',
  'Bearer token (shown once)', 'pg_advisory_xact_lock',
]) has(provision, marker, `credential provisioning includes ${marker}`);
must(!provision.includes('INSERT INTO print_agent_credentials(key_id, agent_id, secret,'), 'provisioning inserts only the digest');

const docker = read('docker/truck-log/server.Dockerfile');
has(docker, 'COPY database/truck-log/migrations ./database/truck-log/migrations', 'server image ships the database migrations');
has(read('docker/truck-log/server-entrypoint.sh'), 'node ./tools/truck-log/migrate.mjs', 'server applies migrations before startup');

const health = read('libs/truck-log/server/feature/health/src/lib/health.controller.ts');
for (const marker of ['print_agents', 'print_agent_credentials', 'print_agent_idempotency', "printAgentApi: 'ready'", 'RELEASE_VERSION']) {
  has(health, marker, `health contract includes ${marker}`);
}

const moduleSource = read('libs/truck-log/server/core/src/lib/truck-log-server.module.ts');
has(moduleSource, 'PrintAgentsModule', 'root server module registers Print Agents');
const packageSource = JSON.parse(read('package.json'));
must(packageSource.scripts['db:migrate'] && packageSource.scripts['db:status'], 'package exposes the migration runner');
must(packageSource.scripts['print-agent:provision'], 'package exposes secure credential provisioning');
must(packageSource.scripts['validate:all'].includes('test:print-agent-api'), 'authoritative validation includes Phase 2 contract');

console.log(`[PASS] Print Agent API Phase 2 contract: ${passed} checks passed.`);
