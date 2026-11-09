import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFeatureSource } from './source-contract-utils.mjs';
import { readSchedulerSource } from './rxo/runtime-sources.mjs';
const RELEASE = fs.readFileSync(path.join(process.cwd(), 'VERSION'), 'utf8').trim();

const root = process.cwd();
const scheduler = path.join(
  root,
  'apps/rxo-integration/src/rxo-scheduler.mjs',
);
const contracts = path.join(
  root,
  'libs/truck-log/shared/contracts/src/index.ts',
);
const component = path.join(
  root,
  'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.ts',
);
const app = path.join(
  root,
  'apps/truck-log/src/app/app.component.ts',
);
const styles = path.join(
  root,
  'libs/truck-log/web/styles/src/styles/rxo.css', // layout only; visuals come from @dana/ui
);

for (const file of [scheduler, contracts, component, app, styles]) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required RXO scheduler file is missing: ${file}`);
  }
}

const read = (file) => fs.readFileSync(file, 'utf8');
// Entry point plus lib/rxo-scheduler-*.mjs (limits and helpers live in the support module).
const schedulerSource = readSchedulerSource(root);
const contractSource = read(contracts);
const componentSource = readFeatureSource(
  root,
  'libs/truck-log/web/feature/rxo-control-center/src/lib',
  ['.ts', '.html', '.css'],
);
const appSource = read(app);
const styleSource = read(styles);

const requireText = (source, marker, label) => {
  if (!source.includes(marker)) {
    throw new Error(`Missing ${label}: ${marker}`);
  }
};

for (const [marker, label] of [
  [`version: process.env.TRUCK_LOG_RELEASE || '${RELEASE}'`, 'scheduler version'],
  ['maxScanDurationMinutes', 'maximum scan duration setting'],
  ['noProgressTimeoutMinutes', 'no-progress setting'],
  ['lastExporterOutputAt', 'exporter progress timestamp'],
  ['exporterChildProcessId', 'child PID diagnostic'],
  ['STALL_DETECTED', 'stall recovery event'],
  ["currentPhase: 'STALLED'", 'stalled phase'],
  ["currentPhase: 'RECOVERING'", 'recovering phase'],
  ["needsReview ? 'NEEDS_REVIEW' : 'FAILED'", 'needs-review phase'],
  ["process.kill(-child.pid, signal)", 'process-group termination'],
  ['MAX_AUTOMATIC_RECOVERY_ATTEMPTS', 'single automatic retry limit'],
  ['scheduler-recovery.log', 'persistent recovery event log'],
]) {
  requireText(schedulerSource, marker, label);
}

for (const marker of [
  'maxScanDurationMinutes',
  'noProgressTimeoutMinutes',
  'exporterChildProcessId',
  'lastExporterOutputAt',
  'lastRecoveryOutcome',
  'recoveryState',
]) {
  requireText(contractSource, marker, 'RXO scheduler recovery contract');
}

for (const marker of [
  '<b>RXO scan stalled.</b>',
  '<b>RXO needs review.</b>',
  'scanRecoveryActive',
  'scanNeedsReview',
  'exporterProgressAgeLabel',
  'stallLimitsLabel',
  'settingsMaxScanDuration',
  'settingsNoProgressTimeout',
]) {
  requireText(componentSource, marker, 'Control Center recovery diagnostic');
}

for (const marker of [
  "STALLED: 'RXO Scan Stalled'",
  "RECOVERING: 'RXO Recovering'",
  "RETRYING: 'RXO Retrying'",
  "NEEDS_REVIEW: 'RXO Needs Review'",
]) {
  requireText(appSource, marker, 'topbar recovery label');
}

requireText(
  styleSource,
  'layout only',
  'layout-only RXO stylesheet',
);
requireText(
  componentSource,
  `<div class="dana-kpi-card" [attr.data-tone]="view.scanNeedsReview ? 'danger' : (view.scanRecoveryActive || view.timerStatusStale ? 'warning' : null)">`,
  'amber (warning-tone) recovery timer',
);
requireText(
  componentSource,
  '<div class="dana-alert dana-alert-warning" *ngIf="view.scanRecoveryActive">',
  'recovery warning alert',
);
requireText(
  componentSource,
  '<div class="dana-alert dana-alert-danger" *ngIf="view.scanNeedsReview">',
  'needs-review alert',
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(file, predicate, timeoutMs = 12_000) {
  const started = Date.now();
  let last = null;

  while (Date.now() - started < timeoutMs) {
    try {
      last = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (predicate(last)) return last;
    } catch {}
    await sleep(50);
  }

  throw new Error(
    `Timed out waiting for scheduler recovery state. Last: ${JSON.stringify(last)}`,
  );
}

async function runScenario(name, exporterSource, predicate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rxo-${name}-`));
  const exporter = path.join(dir, 'exporter.mjs');
  fs.writeFileSync(exporter, exporterSource, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'control-settings.json'),
    JSON.stringify({
      syncIntervalMinutes: 1440,
      maxScanDurationMinutes: 5,
      noProgressTimeoutMinutes: 2,
    }),
  );

  const child = spawn(process.execPath, [scheduler], {
    env: {
      ...process.env,
      RXO_SCHEDULER_TEST_MODE: 'true',
      RXO_EXPORTER_PATH: exporter,
      RXO_DATA_DIR: dir,
      RXO_SYNC_ON_START: 'true',
      RXO_TEST_HEARTBEAT_MS: '50',
      RXO_TEST_WATCHDOG_MS: '40',
      RXO_TEST_MAX_SCAN_DURATION_MS: '1000',
      RXO_TEST_NO_PROGRESS_TIMEOUT_MS: '350',
      RXO_TEST_RECOVERY_COOLDOWN_MS: '100',
      RXO_TEST_TERMINATION_GRACE_MS: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk.toString()));
  child.stderr.on('data', (chunk) => (output += chunk.toString()));

  try {
    const state = await waitFor(
      path.join(dir, 'scheduler-status.json'),
      predicate,
    );
    return { state, output, dir };
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(1000),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

const recoveryExporter = `
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.RXO_DATA_DIR;
const counter = path.join(dir, 'attempt-count');
const attempt = Number(fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8') : '0') + 1;
fs.writeFileSync(counter, String(attempt));
console.log('stub attempt ' + attempt + ' started');
if (attempt === 1) {
  setInterval(() => {}, 1000);
} else {
  fs.writeFileSync(path.join(dir, 'health.json'), JSON.stringify({
    status: 'ok',
    lastBatchId: 'test-batch',
    lastSuccessAt: new Date().toISOString(),
  }));
  console.log('stub attempt 2 completed');
  process.exit(0);
}
`;

const recovered = await runScenario(
  'recovered',
  recoveryExporter,
  (state) =>
    state.recoveryState === 'RECOVERED' &&
    state.lastRecoveryOutcome === 'RECOVERED',
);

if (recovered.state.automaticRecoveryAttempt !== 1) {
  throw new Error('Automatic recovery attempt was not recorded.');
}
if (!recovered.state.lastExporterOutputAt) {
  throw new Error('Exporter output heartbeat was not recorded.');
}
if (!/STALL DETECTED/.test(recovered.output)) {
  throw new Error('Stall detection was not written to scheduler output.');
}
if (!fs.existsSync(path.join(recovered.dir, 'scheduler-recovery.log'))) {
  throw new Error('Persistent scheduler recovery log was not created.');
}

const failingExporter = `
console.log('always-hanging exporter started');
setInterval(() => {}, 1000);
`;

const needsReview = await runScenario(
  'needs-review',
  failingExporter,
  (state) =>
    state.currentPhase === 'NEEDS_REVIEW' &&
    state.lastRecoveryOutcome === 'NEEDS_REVIEW',
);

if (needsReview.state.automaticRecoveryAttempt !== 1) {
  throw new Error('Final recovery attempt was not recorded.');
}
if (!needsReview.state.stallReason) {
  throw new Error('Final stall reason was not recorded.');
}

console.log(
  '[PASS] RXO stall watchdog, process-group termination, one controlled retry, recovered state, NEEDS_REVIEW escalation, persistent recovery log, API/UI diagnostics, and amber status contract.',
);
