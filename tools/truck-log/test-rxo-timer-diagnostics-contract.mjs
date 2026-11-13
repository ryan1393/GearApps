import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFeatureSource } from './source-contract-utils.mjs';
import { readSchedulerSource } from './rxo/runtime-sources.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();

const read = (relative) =>
  fs.readFileSync(path.join(root, relative), 'utf8');

const componentPath =
  'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.ts';
const controlPath =
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control.service.ts';
const contractPath = 'libs/truck-log/shared/contracts/src/index.ts';
// Diagnostics styling comes from @dana/ui (panel, detail grid, alerts); rxo.css is layout only.
const stylesPath =
  'libs/truck-log/web/styles/src/styles/rxo.css';
const schedulerPath =
  'apps/rxo-integration/src/rxo-scheduler.mjs';

const component = readFeatureSource(
  root,
  'libs/truck-log/web/feature/rxo-control-center/src/lib',
  ['.ts', '.html', '.css'],
);
// The control service's Docker/volume runtime lives in rxo-control-runtime.ts.
const control = read(controlPath) + read('libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control-runtime.ts');
const contracts = read(contractPath);
const styles = read(stylesPath);
// Entry point plus lib/rxo-scheduler-*.mjs (limits and helpers live in the support module).
const scheduler = readSchedulerSource(root);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const requireText = (source, marker, label) =>
  assert(source.includes(marker), `Missing ${label}: ${marker}`);

for (const [marker, label] of [
  ['Timer Diagnostics', 'Timer Diagnostics panel'],
  ['schedulerHeartbeatLabel', 'heartbeat display'],
  ['apiRefreshAgeLabel', 'API refresh-age display'],
  ['serverClockOffsetMs', 'remote clock alignment'],
  ['timerStatusStale', 'stale-state guard'],
  ['STATUS STALE', 'stale countdown warning'],
  ['lastRescanConsumedAt', 'manual request consumption'],
  ['schedulerProcessLabel', 'scheduler process diagnostics'],
  ['pageClockTimer', 'single page clock'],
  ['controlPoller', 'status refresh poller'],
  [
    "['QUEUED', 'EXPORTING', 'SYNCING', 'IMPORTING']",
    'manual active phases',
  ],
  ['scanRecoveryActive', 'recovery active-state guard'],
  ['scanNeedsReview', 'needs-review guard'],
  ['exporterProgressAgeLabel', 'exporter progress age'],
  ['stallLimitsLabel', 'stall limit diagnostics'],
  ['recoveryStateLabel', 'recovery state diagnostics'],
  ['<b>RXO scan stalled.</b>', 'stalled warning'],
  ['<b>RXO needs review.</b>', 'needs-review warning'],
]) {
  requireText(component, marker, label);
}

assert(
  !component.includes('document.body'),
  'Legacy document.body polling must be removed.',
);
assert(
  !component.includes('v9StatusTimer'),
  'Legacy timer interval must be removed.',
);
requireText(
  component,
  'window.clearInterval(this.pageClockTimer)',
  'page clock cleanup',
);
requireText(
  component,
  'destroyRef: this.destroyRef,',
  'status poller cleanup with the page',
);

for (const [marker, label] of [
  ['readSchedulerStatus', 'scheduler status reader'],
  ['scheduler-status.json', 'scheduler status file'],
  ['serverTime', 'server time response'],
  ['serverEpochMs', 'server epoch response'],
  ['statusGeneratedAt', 'status generation timestamp'],
  ['scheduler,', 'scheduler response payload'],
  ['maxScanDurationMinutes', 'maximum scan setting'],
  ['noProgressTimeoutMinutes', 'no-progress setting'],
]) {
  requireText(control, marker, label);
}

for (const marker of [
  'export interface RxoSchedulerStatusData',
  'schedulerHeartbeatAt',
  'lastRescanConsumedAt',
  'lastExporterOutputAt',
  'recoveryState',
  'lastRecoveryOutcome',
  'serverEpochMs',
  'scheduler?: RxoSchedulerStatusData | null',
]) {
  requireText(contracts, marker, 'RXO timer contract');
}

requireText(
  styles,
  'layout only',
  'layout-only RXO stylesheet',
);
requireText(
  component,
  '<section class="dana-panel" aria-label="RXO timer diagnostics">',
  'timer diagnostics panel',
);
requireText(
  component,
  '[attr.aria-expanded]="timerDiagnosticsOpen" aria-controls="rxo-diagnostics-body"',
  'timer diagnostics disclosure',
);
requireText(
  component,
  '<div class="dana-alert dana-alert-warning" *ngIf="view.timerStatusStale">\n      <b>Status stale.</b>',
  'stale warning alert',
);

for (const marker of [
  'scheduler-status.json',
  'schedulerHeartbeatAt',
  'lastRescanConsumedAt',
  'lastExporterOutputAt',
  'recoveryState',
  'STALL_DETECTED',
]) {
  requireText(scheduler, marker, 'scheduler diagnostics source');
}

for (const relative of [
  componentPath,
  controlPath,
  'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-control-runtime.ts',
  contractPath,
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
    throw new Error(
      errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(
            error.messageText,
            '\n',
          ),
        )
        .join('\n'),
    );
  }
}

console.log(
  '[PASS] RXO timer diagnostics, clock alignment, stale-state handling, stall progress/recovery diagnostics, interval cleanup, and TypeScript syntax contract.',
);
