import fs from 'node:fs';
import path from 'node:path';

/**
 * Standard RXO scheduler support: environment limits, file locations, JSON
 * helpers, control-settings parsing and child-process signalling. Stateless;
 * the scheduler state machine lives in ../rxo-scheduler.mjs.
 */
const TEST_MODE = /^(1|true|yes)$/i.test(
  process.env.RXO_SCHEDULER_TEST_MODE || 'false',
);
const DATA_DIR = path.resolve(process.env.RXO_DATA_DIR || '/app/data');
const EXPORTER = path.resolve(
  TEST_MODE && process.env.RXO_EXPORTER_PATH
    ? process.env.RXO_EXPORTER_PATH
    : '/app/src/rxo-fort-wayne-export.mjs',
);
const SETTINGS_FILE = path.join(DATA_DIR, 'control-settings.json');
const RESCAN_FILE = path.join(DATA_DIR, 'rescan-request.json');
const HEALTH_FILE = path.join(DATA_DIR, 'health.json');
const SCHEDULER_FILE = path.join(DATA_DIR, 'scheduler-status.json');
const RECOVERY_LOG_FILE = path.join(DATA_DIR, 'scheduler-recovery.log');

const integerEnv = (name, fallback, min, max) => {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(value, min), max);
};

const DEFAULT_INTERVAL_MINUTES = integerEnv(
  'RXO_SYNC_INTERVAL_MINUTES',
  30,
  1,
  1440,
);
const DEFAULT_MAX_SCAN_DURATION_MINUTES = integerEnv(
  'RXO_MAX_SCAN_DURATION_MINUTES',
  30,
  5,
  240,
);
const DEFAULT_NO_PROGRESS_TIMEOUT_MINUTES = integerEnv(
  'RXO_NO_PROGRESS_TIMEOUT_MINUTES',
  15,
  2,
  120,
);
const RECOVERY_COOLDOWN_SECONDS = integerEnv(
  'RXO_RECOVERY_COOLDOWN_SECONDS',
  30,
  5,
  600,
);
const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = integerEnv(
  'RXO_MAX_AUTOMATIC_RECOVERY_ATTEMPTS',
  1,
  0,
  1,
);
const SYNC_ON_START = !/^(0|false|no)$/i.test(
  process.env.RXO_SYNC_ON_START || 'true',
);
const HEARTBEAT_MS = TEST_MODE
  ? integerEnv('RXO_TEST_HEARTBEAT_MS', 100, 20, 10_000)
  : 5_000;
const WATCHDOG_MS = TEST_MODE
  ? integerEnv('RXO_TEST_WATCHDOG_MS', 50, 20, 10_000)
  : 5_000;
const TERMINATION_GRACE_MS = TEST_MODE
  ? integerEnv('RXO_TEST_TERMINATION_GRACE_MS', 150, 20, 30_000)
  : 10_000;
const TEST_MAX_SCAN_DURATION_MS = TEST_MODE
  ? integerEnv('RXO_TEST_MAX_SCAN_DURATION_MS', 1_200, 100, 120_000)
  : null;
const TEST_NO_PROGRESS_TIMEOUT_MS = TEST_MODE
  ? integerEnv('RXO_TEST_NO_PROGRESS_TIMEOUT_MS', 400, 100, 120_000)
  : null;
const TEST_RECOVERY_COOLDOWN_MS = TEST_MODE
  ? integerEnv('RXO_TEST_RECOVERY_COOLDOWN_MS', 200, 10, 120_000)
  : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  try {
    return JSON.parse(
      fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''),
    );
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function appendRecoveryEvent(event) {
  try {
    fs.mkdirSync(path.dirname(RECOVERY_LOG_FILE), { recursive: true });
    fs.appendFileSync(
      RECOVERY_LOG_FILE,
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      'utf8',
    );
  } catch (error) {
    console.error(
      `[RXO-SCHEDULER] Could not write recovery event: ${
        error?.message || error
      }`,
    );
  }
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function currentSettings() {
  const settings = readJson(SETTINGS_FILE) || {};
  const maxScanDurationMinutes = boundedInt(
    settings.maxScanDurationMinutes,
    DEFAULT_MAX_SCAN_DURATION_MINUTES,
    5,
    240,
  );
  const noProgressTimeoutMinutes = Math.min(
    boundedInt(
      settings.noProgressTimeoutMinutes,
      DEFAULT_NO_PROGRESS_TIMEOUT_MINUTES,
      2,
      120,
    ),
    maxScanDurationMinutes,
  );
  return {
    syncIntervalMinutes: boundedInt(
      settings.syncIntervalMinutes,
      DEFAULT_INTERVAL_MINUTES,
      1,
      1440,
    ),
    maxScanDurationMinutes,
    noProgressTimeoutMinutes,
  };
}

function cleanOutput(value) {
  return String(value ?? '')
    .replace(
      /((?:password|passwd|token|authorization)\s*[:=]\s*)\S+/gi,
      '$1[redacted]',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

function signalChild(child, signal) {
  if (!child || child.exitCode !== null) return false;
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
    return true;
  } catch (error) {
    try {
      child.kill(signal);
      return true;
    } catch {
      console.error(
        `[RXO-SCHEDULER] Could not signal exporter child ${child.pid}: ${
          error?.message || error
        }`,
      );
      return false;
    }
  }
}

function attemptLimits(settings) {
  return {
    maxDurationMs:
      TEST_MAX_SCAN_DURATION_MS ??
      settings.maxScanDurationMinutes * 60_000,
    noProgressMs:
      TEST_NO_PROGRESS_TIMEOUT_MS ??
      settings.noProgressTimeoutMinutes * 60_000,
  };
}

export {
  TEST_MODE,
  DATA_DIR,
  EXPORTER,
  SETTINGS_FILE,
  RESCAN_FILE,
  HEALTH_FILE,
  SCHEDULER_FILE,
  RECOVERY_LOG_FILE,
  integerEnv,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_MAX_SCAN_DURATION_MINUTES,
  DEFAULT_NO_PROGRESS_TIMEOUT_MINUTES,
  RECOVERY_COOLDOWN_SECONDS,
  MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
  SYNC_ON_START,
  HEARTBEAT_MS,
  WATCHDOG_MS,
  TERMINATION_GRACE_MS,
  TEST_MAX_SCAN_DURATION_MS,
  TEST_NO_PROGRESS_TIMEOUT_MS,
  TEST_RECOVERY_COOLDOWN_MS,
  sleep,
  readJson,
  writeJsonAtomic,
  appendRecoveryEvent,
  boundedInt,
  currentSettings,
  cleanOutput,
  signalChild,
  attemptLimits,
};
