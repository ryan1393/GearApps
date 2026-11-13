import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readDanaUiStyles } from './source-contract-utils.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const requireText = (source, marker, label) =>
  assert(source.includes(marker), `Missing ${label}: ${marker}`);

const appPath = 'apps/truck-log/src/app/app.component.ts';
const apiPath = 'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts';
const controlPath = 'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.ts';

const app = read(appPath);
const api = read(apiPath);
const control = read(controlPath);
// The topbar badge is a Dana UI pill button; Dana UI owns its tone colors.
const styles = readDanaUiStyles(root);

for (const [marker, label] of [
  ["EXPORTING: 'RXO Exporting'", 'exporting label'],
  ["SYNCING: 'RXO Syncing'", 'syncing label'],
  ["IMPORTING: 'RXO Importing'", 'importing label'],
  ["QUEUED: 'RXO Queued'", 'queued label'],
  ["STALLED: 'RXO Scan Stalled'", 'stalled warning label'],
  ["RECOVERING: 'RXO Recovering'", 'recovering warning label'],
  ["RETRYING: 'RXO Retrying'", 'retrying warning label'],
  ["NEEDS_REVIEW: 'RXO Needs Review'", 'needs-review warning label'],
  ["this.healthLabel = activeLabel;", 'active phase label application'],
  ["this.healthLabel = 'RXO Needs Review';", 'non-core RXO warning state'],
  ["this.healthLabel = 'System Offline';", 'red reserved for core offline'],
  ['class="dana-pill-button"', 'Dana topbar status pill'],
  ["healthState === 'good' ? 'success' : healthState === 'bad' ? 'danger' : healthState === 'warning' ? 'warning' : null", 'warning tone binding'],
  ['this.api.healthLive()', 'liveness fallback'],
  ['this.consecutiveHealthFailures < 3', 'transient health failure suppression'],
  ['truck-log-rxo-system-status', 'RXO shell event'],
  ['WARNING_RXO_PHASE_LABELS', 'warning phase map'],
]) {
  requireText(app, marker, label);
}

assert(
  !app.includes("this.healthLabel = 'System Attention'"),
  'The topbar must not use a generic red System Attention label.',
);
assert(
  !app.includes('api.rxoControl()'),
  'The application shell must not duplicate Control Center Docker-status polling.',
);

assert(
  app.indexOf('if (rxo.active && activeLabel)') <
    app.indexOf("if (this.coreReadiness === 'degraded')"),
  'Active RXO work takes precedence over a live readiness warning so the badge remains green.',
);
assert(
  app.includes('System is online and RXO is active.'),
  'Green active badge explains that the system is online while readiness retries.',
);

const warningBranch = app.slice(
  app.indexOf('if (warningPhaseLabel)'),
  app.indexOf('if (rxo.active && activeLabel)'),
);
assert(
  warningBranch.includes("this.healthState = 'warning';"),
  'Stalled/recovering/needs-review RXO phases must use amber warning state.',
);

const activeBranch = app.slice(
  app.indexOf('if (rxo.active && activeLabel)'),
  app.indexOf('if (rxo.failed)'),
);
assert(
  activeBranch.includes("this.healthState = 'good';"),
  'Active RXO work must keep the topbar in the green good state.',
);

requireText(api, 'healthLive()', 'health liveness method');
requireText(api, "`${this.base}/health/live`", 'health liveness endpoint');

for (const marker of [
  'RXO_SYSTEM_STATUS_EVENT',
  'publishSystemStatus()',
  'this.publishSystemStatus(true)',
  'new CustomEvent<RxoSystemStatusEventDetail>',
  'phase: view.activeTimerPhase',
  "active: view.activeTimerPhase !== 'IDLE'",
]) {
  requireText(control, marker, 'Control Center status publication');
}

requireText(styles, '.dana-pill-button[data-tone="warning"]', 'warning badge style');
requireText(styles, '.dana-pill-button::before', 'status badge dot');

for (const relative of [appPath, apiPath, controlPath]) {
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
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  if (errors.length) {
    throw new Error(
      errors
        .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
        .join('\n'),
    );
  }
}

console.log(
  '[PASS] Truck Log topbar keeps healthy RXO work green, shows stalled/recovery/needs-review states in amber, reserves red for core offline, and avoids duplicate Docker polling.',
);
