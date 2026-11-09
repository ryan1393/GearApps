import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFeatureSource } from './source-contract-utils.mjs';
import { schemaIncludes } from './migration-sql.mjs';

const server = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/rxo-expedite/src/lib', ['.ts']);
const web = fs.readFileSync('libs/truck-log/web/feature/rxo-expedite-control-center/src/lib/rxo-expedite/rxo-expedite.component.ts','utf8');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const clearTool = fs.readFileSync('tools/truck-log/reference-csv/clear-truck-log-data.mjs','utf8');
const serverDockerfile = fs.readFileSync('docker/truck-log/server.Dockerfile','utf8');
const serverEntrypoint = fs.readFileSync('docker/truck-log/server-entrypoint.sh','utf8');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS rxo_expedite_import_batches',
  'CREATE TABLE IF NOT EXISTS rxo_expedite_shipment_snapshots',
  'ux_rxo_expedite_snapshot_batch_shipment',
  "status IN ('IMPORTING','COMPLETE','FAILED')",
]) assert.ok(schemaIncludes(marker), marker);

for (const marker of [
  'implements OnModuleInit, OnModuleDestroy',
  "pg_advisory_xact_lock(hashtext('truck-log-rxo-expedite-ingestion'))",
  'rxo_expedite_import_batches',
  'rxo_expedite_shipment_snapshots',
  "storage: 'POSTGRESQL' as const",
  'databaseIngestionEnabled: database.enabled',
  'syncLatestVerifiedToDatabase',
  "SET LOCAL lock_timeout='15s'",
  "SET LOCAL statement_timeout='90s'",
  'rows.length !== expectedRows',
  "contractVersion: 1 as const, source: 'RXO_EXPEDITE' as const",
]) assert.ok(server.includes(marker), marker);

for (const marker of [
  'Verified-batch database import',
  '<span class="dana-detail-label">Rows imported</span><span class="dana-detail-value">{{s.database?.rowCount',
  '<span class="dana-detail-label">Pending batch</span><span class="dana-detail-value">{{s.database?.pendingBatch',
  "s.database?.state === 'COMPLETE'",
  "shipments?.storage === 'POSTGRESQL'",
]) assert.ok(web.includes(marker), marker);

assert.equal(pkg.scripts['test:rxo-expedite-ingestion'],'node tools/truck-log/test-rxo-expedite-ingestion-contract.mjs');
assert.ok(clearTool.includes("'rxo_expedite_import_batches'"));
assert.ok(clearTool.includes("'rxo_expedite_shipment_snapshots'"));

assert.ok(serverDockerfile.includes('COPY database/truck-log/migrations ./database/truck-log/migrations'));
assert.ok(serverEntrypoint.includes('node ./tools/truck-log/migrate.mjs'));

console.log('[PASS] RXO Expedite PostgreSQL ingestion source contract.');
