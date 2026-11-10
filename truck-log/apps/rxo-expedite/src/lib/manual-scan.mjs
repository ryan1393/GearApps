import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLock, LockBusyError } from './process-lock.mjs';
import { connectionRecoveryStatus, hasPendingAuthRetry, readAuthHold } from './rxo-auth.mjs';

const FILE = 'expedite-manual-scan.json';
const STATES = new Set(['QUEUED', 'RUNNING', 'COMPLETE', 'FAILED']);
const code = value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const active = value => value && ['QUEUED', 'RUNNING'].includes(value.status);

function readJson(root, name) {
  try {
    const file = path.join(root, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw Error('STATE_REVIEW');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Error('STATE_REVIEW');
  }
}

/** Read a positive allowlist; runtime metadata cannot expose native diagnostics or credentials. */
export function readManualScan(root) {
  const value = readJson(root, FILE);
  if (value === null) return null;
  if (!value || value.contractVersion !== 1 || value.source !== 'RXO_EXPEDITE'
    || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
    || !STATES.has(value.status) || !date(value.requestedAt)
    || !(value.startedAt === null || date(value.startedAt))
    || !(value.completedAt === null || date(value.completedAt))
    || !(value.error === null || code(value.error))
    || !(value.sourceBatchId === null || typeof value.sourceBatchId === 'string' && /^[0-9TZ-]+[a-f0-9-]{36}$/.test(value.sourceBatchId))) throw Error('STATE_REVIEW');
  return { id: value.id, status: value.status, requestedAt: value.requestedAt, startedAt: value.startedAt,
    completedAt: value.completedAt, error: value.error, sourceBatchId: value.sourceBatchId };
}

function write(root, value) {
  const file = path.join(root, FILE), temp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ contractVersion: 1, source: 'RXO_EXPEDITE', ...value }) + '\n', { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temp, file); } finally { try { fs.unlinkSync(temp); } catch {} }
  return value;
}

function update(root, operation) {
  const lock = acquireLock(path.join(root, '.expedite-manual-scan.lock'), {
    purpose: 'Expedite scan request', staleAfterMs: 30000, maxHoldMs: 30000, log() {},
  });
  try { return operation(); } finally { lock.release(); }
}

function authBlock(root) {
  if (hasPendingAuthRetry(root, 'expedite')) return 'RECOVERY_PENDING';
  if (readAuthHold(root, 'expedite')) return 'AUTH_REVIEW';
  const recovery = connectionRecoveryStatus(root, 'expedite');
  if (recovery.available) return null;
  if (recovery.requiresCredentials) return 'CREDENTIALS_MISSING';
  if (recovery.requiresInteractiveLogin) return 'AUTH_REVIEW';
  return ['COOLDOWN', 'RETRY_LIMIT', 'STATE_REVIEW'].includes(recovery.reason) ? recovery.reason : 'AUTH_REVIEW';
}

/** Queue work for the existing scheduler; this helper never opens a browser. */
export function requestManualScan(root) {
  try {
    return update(root, () => {
      const prior = readManualScan(root);
      if (active(prior)) return { accepted: true, manualRun: prior };
      const scheduler = readJson(root, 'expedite-scheduler-status.json'), now = Date.now();
      if (!scheduler || scheduler.source !== 'RXO_EXPEDITE' || !['WAITING', 'STARTING', 'EXPORTING'].includes(scheduler.schedulerState)
        || !date(scheduler.schedulerHeartbeatAt) || now - Date.parse(scheduler.schedulerHeartbeatAt) > 90000
        || Date.parse(scheduler.schedulerHeartbeatAt) > now + 30000
        || !date(scheduler.schedulerLoopDeadlineAt) || Date.parse(scheduler.schedulerLoopDeadlineAt) < now) return { accepted: false, errorCode: 'SCHEDULER_UNAVAILABLE' };
      if (scheduler.schedulerState === 'EXPORTING') return { accepted: false, errorCode: 'SCHEDULER_BUSY' };
      const blocked = authBlock(root);
      if (blocked) return { accepted: false, errorCode: blocked };
      const manualRun = write(root, { id: randomUUID(), status: 'QUEUED', requestedAt: new Date(now).toISOString(),
        startedAt: null, completedAt: null, error: null, sourceBatchId: null });
      return { accepted: true, manualRun };
    });
  } catch (error) {
    return { accepted: false, errorCode: error instanceof LockBusyError ? 'REQUEST_BUSY' : 'STATE_REVIEW' };
  }
}

export function failQueuedManualScan(root, error) {
  return update(root, () => {
    const prior = readManualScan(root);
    if (prior?.status !== 'QUEUED') return null;
    return write(root, { ...prior, status: 'FAILED', completedAt: new Date().toISOString(), error: code(error) ? error : 'STATE_REVIEW' });
  });
}

export function startManualScan(root) {
  return update(root, () => {
    const prior = readManualScan(root);
    if (prior?.status !== 'QUEUED') return null;
    const blocked = authBlock(root);
    if (blocked) {
      write(root, { ...prior, status: 'FAILED', completedAt: new Date().toISOString(), error: blocked });
      return null;
    }
    return write(root, { ...prior, status: 'RUNNING', startedAt: new Date().toISOString() });
  });
}

export async function finishManualScan(root, id, error = null, sourceBatchId = null) {
  // An idempotent button request may briefly hold the same lock at export completion.
  // Retry that metadata write so a successful export never stays marked RUNNING.
  // A killed helper in another container remains live-looking until the 30 s lease expires.
  for (let attempt = 0; attempt < 720; attempt++) {
    try {
      return update(root, () => {
        const prior = readManualScan(root);
        if (prior?.id !== id || prior.status !== 'RUNNING') return null;
        return write(root, { ...prior, status: error ? 'FAILED' : 'COMPLETE', completedAt: new Date().toISOString(),
          error: error ? code(error) ? error : 'EXPEDITE_SCHEDULED_EXPORT_FAILED' : null, sourceBatchId: error ? null : sourceBatchId });
      });
    } catch (failure) {
      if (!(failure instanceof LockBusyError) || attempt === 719) throw failure;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

/** A restarted scheduler cannot claim that an interrupted browser export completed. */
export function interruptManualScan(root) {
  return update(root, () => {
    const prior = readManualScan(root);
    if (prior?.status !== 'RUNNING') return null;
    return write(root, { ...prior, status: 'FAILED', completedAt: new Date().toISOString(), error: 'EXPEDITE_SCAN_INTERRUPTED' });
  });
}
