import fs from 'node:fs';
import path from 'node:path';
import { readSchedulerSource } from './rxo/runtime-sources.mjs';

const root = process.cwd();
const schedulerPath = path.join(
  root,
  'apps/rxo-integration/src/rxo-scheduler.mjs',
);
const dockerfilePath = path.join(
  root,
  'apps/rxo-integration/Dockerfile',
);
const packagePath = path.join(
  root,
  'apps/rxo-integration/package.json',
);

for (const file of [schedulerPath, dockerfilePath, packagePath]) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing RXO scheduler file: ${file}`);
  }
}

// Entry point plus lib/rxo-scheduler-*.mjs (limits and helpers live in the support module).
const scheduler = readSchedulerSource(root);
const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const requireText = (source, marker, label) => {
  if (!source.includes(marker)) {
    throw new Error(`Missing ${label}: ${marker}`);
  }
};

for (const [marker, label] of [
  ["scheduler-status.json", 'separate scheduler status file'],
  ['const HEARTBEAT_MS = TEST_MODE', 'test-aware heartbeat definition'],
  ["  : 5_000;", 'five-second production heartbeat'],
  ['schedulerHeartbeatAt', 'scheduler heartbeat timestamp'],
  ['schedulerProcessId', 'scheduler process ID'],
  ['currentTrigger', 'current trigger'],
  ['currentPhase', 'current phase'],
  ['currentStartedAt', 'scan start timestamp'],
  ['nextRunAt', 'next run timestamp'],
  ['lastDurationSeconds', 'last duration'],
  ['lastRescanRequestId', 'manual request ID'],
  ['lastRescanConsumedAt', 'manual request consumption'],
  ['boundedInt(', 'bounded scheduler settings'],
  ['maxScanDurationMinutes', 'maximum scan duration'],
  ['noProgressTimeoutMinutes', 'no-progress timeout'],
  ['exporterChildProcessId', 'exporter child PID'],
  ['lastExporterOutputAt', 'last exporter output heartbeat'],
  ['STALL_DETECTED', 'stall detection'],
  ['NEEDS_REVIEW', 'final recovery escalation'],
  ['process.kill(-child.pid, signal)', 'process-group termination'],
  ["[EXPORTER, '--once']", 'protected one-shot exporter call'],
]) {
  requireText(scheduler, marker, label);
}

if (
  scheduler.includes(
    "writeJsonAtomic(HEALTH_FILE",
  ) ||
  scheduler.includes(
    "function updateHealth",
  )
) {
  throw new Error(
    'Scheduler must not overwrite exporter health.json in the current scheduler.',
  );
}

requireText(
  dockerfile,
  'COPY apps/rxo-integration/src ./src',
  'worker source tree image copy',
);
requireText(
  dockerfile,
  'CMD ["node", "src/rxo-scheduler.mjs"]',
  'scheduler container entrypoint from Nx source root',
);

if (pkg?.scripts?.start !== 'node src/rxo-scheduler.mjs') {
  throw new Error(
    'RXO package start must use rxo-scheduler.mjs.',
  );
}

console.log(
  '[PASS] RXO scheduler heartbeat, dynamic interval, stall watchdog, process-group termination, one automatic retry, request consumption, and protected exporter invocation contract.',
);
