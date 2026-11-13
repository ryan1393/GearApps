import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { acquireLock } from './process-lock.mjs';

export function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

// UTC (what the container clock always used): ids stay unique and sortable even
// when TZ is set to a local zone with a repeated hour at the end of DST.
export function batchId(date = new Date()) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

export function readSecret(filePath, envName) {
  // Environment variables are supported for controlled local testing,
  // but Docker secrets are the preferred production method.
  if (process.env[envName]) {
    const value = String(process.env[envName]).trim();
    if (!value) {
      throw new Error(`${envName} is empty.`);
    }
    return value;
  }

  let value;
  try {
    value = fs.readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    throw new Error(
      `Could not read ${envName}. Expected Docker secret: ${filePath}. ` +
      `Details: ${err.message}`
    );
  }

  if (!value) {
    throw new Error(`${envName} secret file is empty.`);
  }

  return value;
}

// Readers (the scheduler, the API via docker exec/cp) may read at any moment:
// write a complete temp file in the same directory, then rename over the target.
export function writeFileAtomic(filePath, content) {
  mkdirp(path.dirname(filePath));
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { flag: 'wx' });
    fs.renameSync(temp, filePath);
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
}

export function writeJson(filePath, value) {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

// The exporter, a `docker compose run ... --once` test and the interactive
// --login-only bootstrap share one Chromium profile and publish into latest/.
// Only one of them may run at a time, across containers.
const EXPORT_LOCK_FILE = '.rxo-export.lock';
const EXPORT_LOCK_MAX_HOLD_MS = (240 + 15) * 60_000; // longest allowed scan + margin

export function acquireExportLock(dataDir, purpose) {
  mkdirp(dataDir);
  return acquireLock(path.join(dataDir, EXPORT_LOCK_FILE), {
    code: 'RXO_EXPORT_BUSY',
    purpose,
    heartbeatMs: 30_000,
    staleAfterMs: 3 * 60_000,
    maxHoldMs: EXPORT_LOCK_MAX_HOLD_MS,
    log: message => console.log(`[RXO] ${message}`),
  });
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function looksLikeXlsx(filePath) {
  // XLSX is a ZIP container and normally begins with PK.
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buffer, 0, 4, 0);

    if (bytesRead < 2) {
      return false;
    }

    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  } finally {
    fs.closeSync(fd);
  }
}
