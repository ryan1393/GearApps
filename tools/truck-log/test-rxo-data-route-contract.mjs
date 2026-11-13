import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readDanaUiStyles, readFeatureSource } from './source-contract-utils.mjs';
import { schemaSource } from './migration-sql.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();

const read = (relative) =>
  fs.readFileSync(path.join(root, relative), 'utf8');

const controller = read(
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.controller.ts',
);
const service = readFeatureSource(
  root,
  'libs/truck-log/server/feature/rxo-ingestion/src/lib',
  ['.ts'],
);
const api = read(
  'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts',
);
const component = readFeatureSource(
  root,
  'libs/truck-log/web/feature/rxo-control-center/src/lib',
  ['.ts', '.html', '.css'],
);
const contracts = read(
  'libs/truck-log/shared/contracts/src/index.ts',
);
const migration = schemaSource();
// RXO table/summary styling is owned by @dana/ui; Truck Log keeps layout-only rules in rxo.css.
const rxoStyles = read(
  'libs/truck-log/web/styles/src/styles/rxo.css',
);
const danaStyles = readDanaUiStyles(root);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requireText = (source, marker, label) =>
  assert(
    source.includes(marker),
    `Missing ${label}: ${marker}`,
  );

requireText(controller, "@Get('data')", 'RXO data route');
requireText(
  controller,
  'this.rxo.listDataPage(',
  'RXO data service call',
);
requireText(
  service,
  'async listDataPage(',
  'paged data method',
);
requireText(
  service,
  'kind must be orders, shipments, or freight.',
  'kind validation',
);
requireText(service, 'FROM rxo_orders', 'orders query');
requireText(
  service,
  'FROM rxo_shipment_context',
  'shipments query',
);
requireText(
  service,
  'FROM rxo_freight_visibility',
  'freight query',
);
requireText(
  service,
  'visible_in_latest=TRUE',
  'current-data filter',
);
requireText(
  service,
  '(shipment_visible_in_latest=TRUE OR freight_visible_in_latest=TRUE)',
  'shipment visibility includes current Freight On The Move rows',
);
requireText(
  service,
  '(shipments.shipment_visible_in_latest=TRUE OR shipments.freight_visible_in_latest=TRUE)',
  'Shipment KPI visibility includes current Freight On The Move rows',
);
requireText(
  service,
  "INTERVAL '1 day'",
  'active-window one-day lookback',
);
requireText(
  service,
  "INTERVAL '2 days'",
  'active-window tomorrow-end boundary',
);
requireText(
  service,
  "CURRENT_TIMESTAMP AT TIME ZONE",
  'Fort Wayne calendar-window timezone handling',
);
requireText(
  service,
  "'delivered','complete','completed','cancelled','canceled','closed'",
  'terminal-status exclusion',
);
requireText(
  service,
  "CASE WHEN direction='OUTBOUND' THEN pickup_at ELSE delivery_at END",
  'order plant-time direction mapping',
);
requireText(
  component,
  'Active loads only — yesterday, today and tomorrow in Fort Wayne time',
  'Control Center active-window explanation',
);
requireText(
  service,
  'pageSize: safePageSize',
  'page response',
);
requireText(service, 'total: Number(', 'total response');
requireText(
  service,
  'statusSummary: statusRows.map',
  'full filtered status summary response',
);
requireText(
  service,
  "GROUP BY 1\n            ORDER BY count DESC, status\n            LIMIT 6",
  'RXO-style top status summary query',
);
requireText(
  contracts,
  'export interface RxoDataStatusSummaryRecord',
  'status summary contract',
);
requireText(
  contracts,
  'statusSummary: RxoDataStatusSummaryRecord[];',
  'status summary page field',
);
requireText(
  component,
  '<div class="dana-kpi-grid tl-rxo-status-summary" *ngIf="data.dataKind === \'shipments\' || data.dataKind === \'orders\'">',
  'RXO-style shipment/order summary strip',
);
requireText(
  component,
  'Shipment #</th><th>Status</th><th>Direction</th><th>Route</th><th>Carrier</th><th>Site time (ET)</th><th>Driver documents</th>',
  'RXO compact shipment table columns',
);
requireText(
  component,
  '<span class="dana-detail-label">Origin</span><span class="dana-detail-value">{{row.origin_name || \'-\'}}</span><span class="dana-cell-sub">{{row.origin_address',
  'RXO details retain the full origin address',
);
requireText(
  service,
  "STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.origin_name),''), ' / ')",
  'Shipment origin names are enriched from linked RXO Orders',
);
requireText(
  service,
  "STRING_AGG(DISTINCT NULLIF(BTRIM(linked_order.destination_name),''), ' / ')",
  'Shipment destination names are enriched from linked RXO Orders',
);
requireText(
  service,
  'linked_link.visible_in_latest = TRUE',
  'Shipment endpoint enrichment only uses current linked RXO Orders',
);
requireText(
  component,
  'Order #</th><th>Status</th><th>Shipment #</th><th>Direction</th><th>Route</th><th>Site time (ET)</th>',
  'RXO compact order table columns',
);
requireText(
  component,
  '[attr.data-tone]="statusTone(item.status) === \'warning\' ? \'warning\' : null"',
  'status summary tone binding',
);
requireText(
  rxoStyles,
  'RXO and RXO Expedite Control Centers — layout only.',
  'RXO layout-only stylesheet',
);
for (const marker of ['.dana-kpi-grid', '.dana-kpi-card', '.dana-table-shell', '.dana-table th', '.dana-status-badge[data-tone']) {
  requireText(danaStyles, marker, 'Dana UI data-board styling');
}
for (const dataset of ['shipments', 'orders', 'freight']) {
  requireText(
    component,
    `role="region" tabindex="0" aria-label="RXO ${dataset} results">\n    <table class="dana-table tl-wide-table" data-rxo-dataset="${dataset}">`,
    `scrollable Dana table region for RXO ${dataset}`,
  );
}
requireText(
  api,
  '${this.base}/rxo/data',
  'frontend data endpoint',
);
requireText(
  contracts,
  'export interface RxoDataPage',
  'data page contract',
);
requireText(
  migration,
  'CREATE TABLE IF NOT EXISTS rxo_orders',
  'orders schema',
);
requireText(
  migration,
  'CREATE OR REPLACE VIEW rxo_shipment_context',
  'shipment view schema',
);
requireText(
  migration,
  'CREATE TABLE IF NOT EXISTS rxo_freight_visibility',
  'freight schema',
);

assert(
  !/[Ãâ]/.test(component),
  'RXO Control Center still contains mojibake characters.',
);

requireText(
  component,
  "'Scan running…'",
  'clean scan-running label',
);
requireText(
  component,
  '<th>Site time (ET)</th>',
  'Eastern site-time header',
);
requireText(
  component,
  'formatEasternRxoTime',
  'Eastern RXO time formatter',
);
requireText(
  component,
  "easternShiftHours: Record<string, number> = { ET: 0, CT: 1, MT: 2, PT: 3 }",
  'Central-to-Eastern one-hour wall-clock conversion',
);
requireText(
  component,
  "timeZone: 'America/New_York'",
  'ISO RXO times render in Eastern time',
);

for (const relative of [
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.controller.ts',
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.service.ts',
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.queries.ts',
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-snapshot-writer.ts',
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion-paths.ts',
  'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.ts',
]) {
  const source = read(relative);

  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
    reportDiagnostics: true,
    fileName: relative,
  });

  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error,
  );

  if (errors.length) {
    const message = errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          '\n',
        ),
      )
      .join('\n');

    throw new Error(
      `TypeScript syntax failed for ${relative}:\n${message}`,
    );
  }
}

assert(
  contracts.includes('pickup_appointment_arrival_raw?: string | null;') &&
    contracts.includes('delivery_appointment_arrival_raw?: string | null;'),
  'Shipment/Freight contracts expose RXO pickup and drop-off time fields',
);
assert(
  contracts.includes('origin_name?: string | null;') &&
    contracts.includes('origin_address?: string | null;') &&
    contracts.includes('destination_name?: string | null;') &&
    contracts.includes('destination_address?: string | null;'),
  'Shipment contract exposes Order-style origin/destination fields',
);
assert(
  migration.includes('visibility.pickup_estimated_arrival_raw') &&
    migration.includes('visibility.pickup_appointment_arrival_raw') &&
    migration.includes('visibility.delivery_estimated_arrival_raw') &&
    migration.includes('visibility.delivery_appointment_arrival_raw'),
  'RXO shipment context exposes pickup/drop-off timing from Freight On The Move',
);
assert(
  service.includes('raw_row') &&
    (service.includes("this.orderStopDate(raw, 'pickup')?.toISOString()") || service.includes("ctx.orderStopDate(raw, 'pickup')?.toISOString()")) &&
    (service.includes("this.orderStopDate(raw, 'delivery')?.toISOString()") || service.includes("ctx.orderStopDate(raw, 'delivery')?.toISOString()")) &&
    service.includes('const { raw_row: _rawRow, ...publicRow } = row;'),
  'Existing RXO Order rows can immediately backfill missing pickup/drop-off times from stored raw_row without exposing raw JSON',
);
assert(
  service.includes("pickupAt: this.orderStopDate(row, 'pickup')") &&
    service.includes("deliveryAt: this.orderStopDate(row, 'delivery')") &&
    !service.includes("kind === 'pickup' && direction !== 'OUTBOUND'") &&
    !service.includes("kind === 'delivery' && direction !== 'INBOUND'"),
  'RXO order ingestion keeps both pickup and drop-off timestamps regardless of direction',
);
assert(
  (component.match(/<th>Site time \(ET\)<\/th>/g) ?? []).length === 3 &&
    !/<th>Plant Schedule<\/th>/i.test(component) &&
    !/<th>Plant Time<\/th>/i.test(component),
  'RXO visible tables use a consolidated Eastern site-time column',
);
assert(
  component.includes('row.pickup_appointment_arrival_raw?.trim() ||') &&
    component.includes('row.pickup_estimated_arrival_raw?.trim() ||') &&
    component.includes('row.delivery_appointment_arrival_raw?.trim() ||') &&
    component.includes('row.delivery_estimated_arrival_raw?.trim() ||') &&
    component.includes('formatEasternRxoTime'),
  'Shipment/Freight tables prefer RXO appointment time then estimated time and normalize display to Eastern',
);

console.log(
  '[PASS] RXO paged data route, filters, paging contract, schema references, and encoding checks passed.',
);
