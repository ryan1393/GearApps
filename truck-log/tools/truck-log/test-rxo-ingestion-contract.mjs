import fs from 'node:fs';
import path from 'node:path';
import { readFeatureSource } from './source-contract-utils.mjs';
import { readSchemaSql, schemaIncludes, schemaTable, schemaStatement, schemaCount } from './migration-sql.mjs';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const must = (condition, message) => {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`[PASS] ${message}`);
  }
};

const sql = readSchemaSql();
for (const table of [
  'rxo_import_batches',
  'rxo_orders',
  'rxo_shipments',
  'rxo_freight_visibility',
  'rxo_order_shipment_links',
]) {
  must(schemaIncludes(`CREATE TABLE IF NOT EXISTS ${table}`), `RXO schema includes ${table}`);
}
must(schemaIncludes('CREATE OR REPLACE VIEW rxo_shipment_context'), 'RXO combined shipment context view exists');
const shipmentViewSql = schemaStatement('CREATE VIEW rxo_shipment_context AS');
must(!shipmentViewSql.includes('select combined.*'),
  'RXO shipment view uses explicit legacy column order');
must(
  shipmentViewSql.indexOf('as linked_order_count') >= 0
    && shipmentViewSql.indexOf('as linked_order_count') < shipmentViewSql.indexOf('combined.pickup_estimated_arrival_raw'),
  'RXO timing columns append after legacy shipment-context columns',
);
must(schemaIncludes("direction IN ('INBOUND','OUTBOUND')"), 'RXO rows are direction constrained');
must(schemaCount('site_key VARCHAR(80) NOT NULL') >= 5,
  'RXO import and normalized tables are site-key scoped');
must(schemaIncludes('visible_in_latest BOOLEAN NOT NULL DEFAULT TRUE'),
  'RXO normalized tables retain latest-snapshot visibility');
must(schemaIncludes('UNIQUE(site_key, order_number, direction)'),
  'RXO Orders uniqueness is site + order + direction');
must(schemaIncludes('UNIQUE(site_key, shipment_id, direction)'),
  'RXO Shipment/FOM uniqueness is site + shipment + direction');
must(schemaIncludes('UNIQUE(site_key, order_number, shipment_id, direction)'),
  'RXO Order-to-Shipment links are site scoped');
must(schemaIncludes('dataset_summary JSONB'), 'RXO import batches retain dataset/header audit summary');
must(schemaIncludes('deactivated_scheduled_load_rows'), 'RXO import batches record terminal schedule deactivations');
must(schemaCount('visible_in_latest BOOLEAN NOT NULL DEFAULT TRUE') >= 3,
  'RXO Orders, Shipments, and FOM track whether rows were visible in the latest snapshot');
for (const constraint of [
  'fk_rxo_orders_batch',
  'fk_rxo_shipments_batch',
  'fk_rxo_freight_visibility_batch',
  'fk_rxo_order_shipment_links_batch',
]) must(schemaIncludes(constraint), `RXO normalized rows are tied to import batches: ${constraint}`);

const tableBlock = (table) => {
  const block = schemaTable(table);
  must(block.startsWith(`create table ${table}(`), `RXO SQL table block can be located: ${table}`);
  return block;
};

for (const table of ['rxo_orders','rxo_shipments','rxo_freight_visibility','rxo_order_shipment_links']) {
  const block = tableBlock(table);
  must(/\bsite_key varchar\(80\)not null/.test(block), `${table} physically declares site_key`);
  must(/\bsource_batch_id varchar\(80\)not null/.test(block), `${table} physically declares source_batch_id`);
  must(/foreign key\(site_key,source_batch_id\)/.test(block), `${table} composite batch FK uses declared site_key + source_batch_id`);
}

must(/unique\(site_key,source_batch_id\)/.test(tableBlock('rxo_import_batches')),
  'rxo_import_batches physically declares site + batch uniqueness');
must(/unique\(site_key,order_number,direction\)/.test(tableBlock('rxo_orders')),
  'rxo_orders physically declares site-scoped business uniqueness');
must(/unique\(site_key,shipment_id,direction\)/.test(tableBlock('rxo_shipments')),
  'rxo_shipments physically declares site-scoped business uniqueness');
must(/unique\(site_key,shipment_id,direction\)/.test(tableBlock('rxo_freight_visibility')),
  'rxo_freight_visibility physically declares site-scoped business uniqueness');
must(/unique\(site_key,order_number,shipment_id,direction\)/.test(tableBlock('rxo_order_shipment_links')),
  'rxo_order_shipment_links physically declares site-scoped link uniqueness');

must(!fs.existsSync(path.join(root, 'tools/truck-log/apply-rxo-ingestion-upgrade.mjs')) &&
  !fs.existsSync(path.join(root, 'tools/truck-log/rollback-rxo-ingestion-upgrade.mjs')),
  'Retired RXO patch/rollback utilities are absent from the current release');

const servicePath = 'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.service.ts';
const service = readFeatureSource(root, 'libs/truck-log/server/feature/rxo-ingestion/src/lib', ['.ts']);
for (const marker of [
  "'12808'",
  "'DANA_USA_FORT_WAYNE_IN'",
  "'orders|OUTBOUND'",
  "'orders|INBOUND'",
  "'shipments|OUTBOUND'",
  "'shipments|INBOUND'",
  "'freight-on-the-move|OUTBOUND'",
  "'freight-on-the-move|INBOUND'",
  'Origin=OUTBOUND',
  'Destination=INBOUND',
  'MAX_ROWS = 25000',
  'RXO:${siteKey}:',
  "pg_advisory_xact_lock(hashtext('truck-log-rxo-ingestion'))",
  'jsonb_to_recordset',
  'visible_in_latest=FALSE',
  "status='FAILED'",
]) {
  must(service.includes(marker), `RXO ingestion service marker: ${marker}`);
}

// These headers come from the real RXO Orders export schema supplied during
// development. Keep them covered so the parser does not regress to screenshot-only names.
for (const marker of [
  'Origin Location Name',
  'Origin Address Line 1',
  'Destination Location Name',
  'Destination Address Line 1',
  'Early Pickup Date',
  'Early Pickup Time',
  'Early Delivery Date',
  'Early Delivery Time',
  'Customer Order Number',
]) must(service.includes(marker), `RXO real Orders export header is supported: ${marker}`);

for (const marker of [
  "'Pickup - Appointment Arrival'",
  "'Delivery - Appointment Arrival'",
  "'Order ID'",
  "'Shipment ID'",
  "'First Stop Address'",
  "'Last Stop Address'",
  "'Pro #'",
  "'Trailer #'",
  "'Is Hazardous?'",
]) must(service.includes(marker), `RXO Shipment/FOM export header is supported: ${marker}`);

must(service.includes('directionSets.get(row.shipmentId)?.size'), 'Ambiguous bidirectional Shipment IDs are not auto-scheduled');
must(service.includes('syncScheduledLoads(manager, orders, shipments, freight, batchId, siteKey)'),
  'Scheduled-load ownership is site-qualified');
must(service.includes('scheduled.source LIKE $2') && service.includes('sourcePrefix = `RXO:${siteKey}:`'),
  'Only same-site RXO-owned scheduled loads are auto-deactivated by RXO synchronization');
must(service.includes('isTerminalStatus(row.status)'), 'Terminal RXO shipment states do not remain active scheduled loads');
must(service.includes('Absence from the latest RXO export does NOT deactivate Truck Log schedules'),
  'Missing from a later RXO export does not deactivate a Truck Log schedule');
must(service.includes('directionSets.get(row.shipmentId)?.size'), 'Ambiguous bidirectional Shipment IDs are excluded from retained schedules');
must(service.includes('shipment.orderNumbers'), 'Shipment export Order ID values supplement Orders-to-Shipments linkage');
must(service.includes('boundarySourceHash'), 'RXO idempotence uses a source-only boundary digest');
must(service.includes('const snapshot = await this.snapshotReader.parseSnapshot(boundary);') || service.includes('const snapshot = await this.parseSnapshot(boundary);'), 'RXO XLSX parsing completes before the PostgreSQL write transaction');
must(service.includes('duplicatesCollapsed'), 'RXO dataset audit records duplicate-key collapse counts');
must(service.includes('dedupeShipments'), 'RXO keyed rows are deduplicated before bulk upsert');
must(service.includes('SKIPPED_POSSIBLE_RXO_EXPORT_CEILING'),
  'RXO capped datasets are explicitly skipped instead of silently imported');
must(service.includes('partial: warnings.length > 0'),
  'RXO import reports partial completion when a capped dataset is skipped');
must(service.includes('completeDirections.orders') &&
  service.includes("completeDirections['freight-on-the-move']"),
  'RXO latest visibility refresh is limited to complete dataset directions');
must(service.includes('direction=$2 AND visible_in_latest=TRUE'),
  'A skipped direction does not invalidate previously imported latest rows');
must(service.includes('ON CONFLICT(site_key,order_number,direction)'), 'RXO Orders import is site-scoped and idempotent');
must((service.match(/ON CONFLICT\(site_key,shipment_id,direction\)/g) || []).length >= 2,
  'RXO Shipments/FOM import is site-scoped and idempotent');


for (const entityPath of [
  'libs/truck-log/server/data-access/src/lib/entities/rxo-order.entity.ts',
  'libs/truck-log/server/data-access/src/lib/entities/rxo-shipment.entity.ts',
  'libs/truck-log/server/data-access/src/lib/entities/rxo-freight-visibility.entity.ts',
  'libs/truck-log/server/data-access/src/lib/entities/rxo-order-shipment-link.entity.ts',
]) {
  const entityText = read(entityPath);
  must(entityText.includes("name: 'site_key'"), `${entityPath} maps site_key`);
}
must(read('libs/truck-log/server/data-access/src/lib/entities/rxo-order-shipment-link.entity.ts').includes("name: 'visible_in_latest'"),
  'RXO link entity maps latest-snapshot visibility');
must(!read('libs/truck-log/server/data-access/src/lib/entities/rxo-import-batch.entity.ts').includes('unique: true }) sourceBatchId'),
  'RXO import batch does not declare source_batch_id globally unique');

const moduleText = read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.module.ts');
for (const entity of [
  'RxoImportBatch', 'RxoOrder', 'RxoShipment', 'RxoFreightVisibility', 'RxoOrderShipmentLink',
]) {
  must(moduleText.includes(entity), `RXO TypeORM module registers ${entity}`);
}

const serverModule = read('libs/truck-log/server/core/src/lib/truck-log-server.module.ts');
must(serverModule.includes('RxoIngestionModule'), 'Truck Log server imports RXO ingestion feature');

const controller = read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.controller.ts');
for (const marker of [
  "@Controller('rxo')",
  "@Get('status')",
  "@Post('import-latest')",
  "@Get('shipments')",
  "@Get('orders')",
  "@Get('shipments/:shipmentId')",
]) {
  must(controller.includes(marker), `RXO API route marker ${marker}`);
}

const sync = read('apps/rxo-integration/sync-latest-to-truck-log.ps1');
must(sync.includes('TRUCK_LOG_RXO_IMPORT_AFTER_SYNC'), 'RXO local sync supports automatic PostgreSQL import');
must(sync.includes('tools\\truck-log\\rxo\\import-latest.ps1'), 'RXO local sync calls canonical import bridge');
must(sync.includes('IMPORT-RXO-LATEST.cmd'), 'RXO sync failure tells operator how to retry DB import without recopying source');

const importBridge = read('tools/truck-log/rxo/import-latest.ps1');
must(importBridge.includes('/rxo/import-latest'), 'Host-side RXO bridge calls the canonical API import endpoint');
must(importBridge.includes('postgresImportedAt'), 'Host-side RXO bridge annotates local boundary after committed import');
must(importBridge.includes('-TimeoutSec 600'), 'Large RXO imports have a bounded ten-minute API bridge timeout');
must(importBridge.includes('ErrorDetails') && importBridge.includes('API response:'),
  'RXO host import bridge surfaces the real API error response body');

const compose = read('docker-compose.yml');
must(compose.includes('truck-log-rxo-import:/data/truck-log-rxo') && compose.includes('TRUCK_LOG_RXO_DOCKER_DATA_VOLUME: truck-log-rxo-data'), 'Docker server separates its writable RXO import cache from the exporter source volume');
must(compose.includes('TRUCK_LOG_RXO_LATEST_DIR: /data/truck-log-rxo/latest') && compose.includes('/var/run/docker.sock:/var/run/docker.sock'), 'Docker server resolves canonical RXO latest path and has Docker control access');

const start = read('tools/truck-log/start-truck-log.ps1');
must(start.includes('/api/v1/rxo/status'), 'Normal Truck Log startup smoke-tests RXO ingestion readiness');

const clear = read('tools/truck-log/reference-csv/clear-truck-log-data.mjs');
for (const table of ['rxo_import_batches','rxo_orders','rxo_shipments','rxo_freight_visibility','rxo_order_shipment_links']) {
  must(clear.includes(`'${table}'`), `Full Truck Log clear/reset includes ${table}`);
}

must(fs.existsSync(path.join(root, 'IMPORT-RXO-LATEST.cmd')), 'Root IMPORT-RXO-LATEST.cmd exists');
must(fs.existsSync(path.join(root, 'tools/truck-log/rxo/import-latest.ps1')), 'RXO API import bridge exists');

const pkg = JSON.parse(read('package.json'));
must(!pkg.scripts?.['db:rxo-upgrade'] && !pkg.scripts?.['db:rxo-rollback'], 'Retired RXO patch/rollback npm commands are absent');
must(Boolean(pkg.scripts?.['test:rxo-ingestion']), 'RXO ingestion regression npm command exists');
must(String(pkg.scripts?.['validate:all'] || '').includes('test-rxo-ingestion-contract.mjs'), 'validate:all includes RXO ingestion contract');

const appServerFiles = fs.readdirSync(path.join(root, 'apps/truck-log-server/src/app'));
must(appServerFiles.length === 1 && appServerFiles[0] === 'app.module.ts', 'NestJS app remains composition-only after RXO ingestion');
must(fs.existsSync(path.join(root, servicePath)), 'RXO ingestion implementation stays under libs/truck-log/server');

if (process.exitCode) {
  console.error('[FAIL] Truck Log RXO ingestion contract.');
  process.exit();
}

must(schemaIncludes('visibility.pickup_appointment_arrival_raw'), 'Shipment context carries RXO pickup appointment time');
must(schemaIncludes('visibility.delivery_appointment_arrival_raw'), 'Shipment context carries RXO drop-off appointment time');
must(service.includes("pickupAt: this.orderStopDate(row, 'pickup')") || service.includes("pickupAt: this.snapshotReader.orderStopDate(row, 'pickup')"), 'Order import parses pickup time for every direction');
must(service.includes("deliveryAt: this.orderStopDate(row, 'delivery')") || service.includes("deliveryAt: this.snapshotReader.orderStopDate(row, 'delivery')"), 'Order import parses drop-off time for every direction');
// One boundary file name: the verifier writes it, the server reads it (0.1 read a different name, so every import failed).
{
  const written = read('tools/truck-log/rxo/verify-local-rxo-latest.mjs').match(/path\.join\(root, '([^']+boundary[^']*\.json)'\)/)?.[1];
  const paths = read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion-paths.ts');
  must(written && paths.includes(`export const RXO_BOUNDARY_FILE = '${written}';`), `server reads the boundary file the verifier writes (${written})`);
  must(read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-snapshot-fields.ts').includes('path.join(this.latestRootPath, RXO_BOUNDARY_FILE)'), 'snapshot reader uses the shared boundary file name');
  must(read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.service.ts').includes('path.join(staging, RXO_BOUNDARY_FILE)'), 'sync uses the shared boundary file name');
}
// Print Agent packing slips must use the status the Dock Board scan looks for (0.1 stored FOUND, so no slip ever matched).
must(read('libs/truck-log/server/feature/print-agents/src/lib/packing-slip-ingestion.service.ts').includes("extractionStatus: 'DETECTED',") && read('libs/truck-log/server/feature/visits/src/lib/dock-packing-scan.service.ts').includes("doc.extractionStatus !== 'DETECTED'"), 'Print Agent slips use the DETECTED status the Dock Board matches');
console.log('[PASS] Truck Log RXO ingestion contract.');
