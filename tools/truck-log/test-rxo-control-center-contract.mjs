import { currentRuntime } from './rxo/current-runtime-contract.mjs';
import { readExporterSource, readSchedulerSource } from './rxo/runtime-sources.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readFeatureSource } from './source-contract-utils.mjs';
const RELEASE = (await import('node:fs')).readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();

const root = process.cwd();
let failures = 0;

const full = (relative) => path.join(root, relative);
const exists = (relative) => fs.existsSync(full(relative));
const text = (relative) => fs.readFileSync(full(relative), 'utf8');
const sha256 = (relative) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(full(relative)))
    .digest('hex');

const check = (condition, message) => {
  if (condition) console.log(`[PASS] ${message}`);
  else {
    failures += 1;
    console.error(`[FAIL] ${message}`);
  }
};

const files = {
  component:
    'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.ts',
  app: 'apps/truck-log/src/app/app.component.ts',
  controlService:
    'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.service.ts',
  controlController:
    'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.controller.ts',
  ingestionController:
    'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.controller.ts',
  ingestionService:
    'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.service.ts',
  api:
    'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts',
  styles:
    'libs/truck-log/web/styles/src/styles/rxo.css', // layout only; visuals come from @dana/ui
  contracts: 'libs/truck-log/shared/contracts/src/index.ts',
  compose: 'docker-compose.yml',
  scheduler: 'apps/rxo-integration/src/rxo-scheduler.mjs',
  exporter: 'apps/rxo-integration/src/rxo-fort-wayne-export.mjs',
  exporterDockerfile: 'apps/rxo-integration/Dockerfile',
  exporterPackage: 'apps/rxo-integration/package.json',
  runtimeManifest: 'apps/rxo-integration/RUNTIME-MANIFEST.json',
  packageJson: 'package.json',
  timerContract:
    'tools/truck-log/test-rxo-scan-timer-contract.mjs',
  diagnosticsContract:
    'tools/truck-log/test-rxo-timer-diagnostics-contract.mjs',
  stallContract:
    'tools/truck-log/test-rxo-stall-recovery-contract.mjs',
  dataContract:
    'tools/truck-log/test-rxo-data-route-contract.mjs',
};

for (const [label, relative] of Object.entries(files)) {
  check(exists(relative), `${relative} exists`);
}

const component = readFeatureSource(
  root,
  'libs/truck-log/web/feature/rxo-control-center/src/lib',
  ['.ts', '.html', '.css'],
);
for (const marker of [
  'RXO Control Center',
  'RXO Data',
  'Exporter Health',
  'Settings &amp; Login',
  'Run Scan Now',
  'Sync Current Export',
  'Next scan in',
  'Scan elapsed',
  'Save scan settings',
  'Timer Diagnostics',
  'STATUS STALE',
  'serverClockOffsetMs',
  'schedulerHeartbeatLabel',
  'lastRescanConsumedAt',
  'maxScanDurationMinutes',
  'noProgressTimeoutMinutes',
  'exporterProgressAgeLabel',
  'recoveryStateLabel',
  '<b>RXO scan stalled.</b>',
  '<b>RXO needs review.</b>',
]) {
  check(
    component.includes(marker),
    `RXO Control Center marker: ${marker}`,
  );
}

check(
  !/[Ãâ]/.test(component),
  'RXO Control Center contains no mojibake characters',
);
check(
  !component.includes('document.body'),
  'Legacy document.body timer polling is removed',
);
check(
  !component.includes('v9StatusTimer'),
  'Legacy timer interval is removed',
);
check(
  component.includes('window.clearInterval(this.pageClockTimer)') &&
    component.includes('this.controlPoller = createPoller({') &&
    component.includes('destroyRef: this.destroyRef,'),
  'Page clock is cleared and the status poller is torn down with the page',
);

const app = text(files.app);
for (const marker of [
  "STALLED: 'RXO Scan Stalled'",
  "RECOVERING: 'RXO Recovering'",
  "RETRYING: 'RXO Retrying'",
  "NEEDS_REVIEW: 'RXO Needs Review'",
]) {
  check(app.includes(marker), `Global status marker: ${marker}`);
}

// The control service's Docker/volume runtime lives in rxo-control-runtime.ts.
const controlService = text(files.controlService) + text('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control-runtime.ts');
for (const marker of [
  'control-settings.json',
  'rescan-request.json',
  'scheduler-status.json',
  'readSchedulerStatus',
  'serverTime',
  'serverEpochMs',
  'statusGeneratedAt',
  'this.ingestion.importLatest()',
  'maxScanDurationMinutes',
  'noProgressTimeoutMinutes',
  'settings.maxScanDurationMinutes * 2 + 5',
  'automatic recovery allowance',
]) {
  check(
    controlService.includes(marker),
    `RXO control backend marker: ${marker}`,
  );
}
check(
  !/password\s*:\s*password\b/.test(controlService),
  'RXO status path does not return a plaintext password',
);

const scheduler = readSchedulerSource(root);
for (const marker of [
  `version: process.env.TRUCK_LOG_RELEASE || '${RELEASE}'`,
  'scheduler-status.json',
  'scheduler-recovery.log',
  'const HEARTBEAT_MS = TEST_MODE',
  '5_000',
  'schedulerHeartbeatAt',
  'schedulerProcessId',
  'currentTrigger',
  'currentPhase',
  'lastRescanConsumedAt',
  'boundedInt(',
  'maxScanDurationMinutes',
  'noProgressTimeoutMinutes',
  'exporterChildProcessId',
  'lastExporterOutputAt',
  'STALL_DETECTED',
  'RECOVERING',
  'RETRYING',
  'NEEDS_REVIEW',
  'process.kill(-child.pid, signal)',
  "[EXPORTER, '--once']",
]) {
  check(scheduler.includes(marker), `RXO scheduler marker: ${marker}`);
}
check(
  !scheduler.includes('function updateHealth'),
  'Scheduler no longer races exporter health.json writes',
);

// The exporter entry is thin; its site/direction rules live in lib/rxo-export-*.mjs.
const exporter = readExporterSource(root);
for (const marker of [
  '12808',
  'DANA_USA_FORT_WAYNE_IN',
  '10000',
  "'Origin'",
  "'OUTBOUND'",
  "'Destination'",
  "'INBOUND'",
]) {
  check(exporter.includes(marker), `Protected exporter marker: ${marker}`);
}

const runtimeManifest = currentRuntime(root);
const expectedExporter = runtimeManifest.files?.['apps/rxo-integration/src/rxo-fort-wayne-export.mjs']?.sha256 ?? null;
check(
  /^[a-f0-9]{64}$/i.test(String(expectedExporter ?? '')),
  'Expected exporter SHA is available from the runtime manifest',
);
if (/^[a-f0-9]{64}$/i.test(String(expectedExporter ?? ''))) {
  check(
    sha256(files.exporter).toLowerCase() === String(expectedExporter).toLowerCase(),
    'Exporter source hash matches the runtime manifest',
  );
}
for (const relative of ['Dockerfile', 'package.json', 'src/rxo-scheduler.mjs']) {
  const manifestPath = `apps/rxo-integration/${relative}`;
  const expected = runtimeManifest.files?.[manifestPath]?.sha256;
  check(
    Boolean(expected) && String(expected).toLowerCase() === sha256(manifestPath).toLowerCase(),
    `RXO runtime manifest hash: ${relative.replace(/^src\//, '')}`,
  );
}

const ingestionController = text(files.ingestionController);
const ingestionService = readFeatureSource(
  root,
  'libs/truck-log/server/feature/rxo-ingestion/src/lib',
  ['.ts'],
);
check(
  ingestionController.includes("@Get('data')") &&
    ingestionController.includes('this.rxo.listDataPage('),
  'RXO paged data controller route exists',
);
for (const marker of [
  'async listDataPage(',
  'FROM rxo_orders',
  'FROM rxo_shipment_context',
  'FROM rxo_freight_visibility',
  'visible_in_latest=TRUE',
  'pageSize: safePageSize',
]) {
  check(
    ingestionService.includes(marker),
    `RXO data backend marker: ${marker}`,
  );
}

const contracts = text(files.contracts);
for (const marker of [
  'RxoSchedulerStatusData',
  'schedulerHeartbeatAt',
  'lastRescanConsumedAt',
  'lastExporterOutputAt',
  'exporterChildProcessId',
  'automaticRecoveryAttempt',
  'recoveryState',
  'lastRecoveryOutcome',
  'serverEpochMs',
  'scheduler?: RxoSchedulerStatusData | null',
]) {
  check(contracts.includes(marker), `RXO contract marker: ${marker}`);
}

const compose = text(files.compose);
for (const marker of [
  `truck-log-rxo-export:\${TRUCK_LOG_RELEASE:-${RELEASE}}`,
  'RXO_MAX_SCAN_DURATION_MINUTES',
  'RXO_NO_PROGRESS_TIMEOUT_MINUTES',
  'RXO_MAX_AUTOMATIC_RECOVERY_ATTEMPTS: "1"',
]) {
  check(compose.includes(marker), `Root Compose marker: ${marker}`);
}

const pkg = JSON.parse(text(files.packageJson));
for (const script of [
  'test:rxo-control-center',
  'test:rxo-data-route',
  'test:rxo-scan-timer',
  'test:rxo-timer-diagnostics',
  'test:rxo-stall-recovery',
]) {
  check(Boolean(pkg.scripts?.[script]), `Root script exists: ${script}`);
}

if (failures) {
  console.error(
    `\nRXO Control Center contract failed ${failures} check(s).`,
  );
  process.exit(1);
}

console.log(
  '\n[PASS] Truck Log RXO Control Center contract matches the stall watchdog, automatic recovery, timer diagnostics, protected exporter, and paged data architecture.',
);

// The API verifies the exporter's whole source tree, not only its entry file.
check(controlService.includes("find src -type f | LC_ALL=C sort | xargs sha256sum | sha256sum") && controlService.includes('imageSourceDigest'),
  'Control Center verifies the running exporter against the release-wide source digest');
check(/^[0-9a-f]{64}$/.test(runtimeManifest.imageSourceDigest || ''), 'runtime manifest carries the exporter image source digest');
check(text("docker/truck-log/server.Dockerfile").includes('COPY apps/rxo-integration/RUNTIME-MANIFEST.json'), 'server image ships the runtime manifest it verifies against');

