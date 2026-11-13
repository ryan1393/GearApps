/** Cross-process lock files for the RXO workers.
 *
 * A lock is a small JSON file created atomically (write temp, hard-link into
 * place) that records who holds it: pid, hostname (the container id), the
 * kernel start time of that pid, when it was taken and when the holder last
 * refreshed it. A lock is STALE, and is broken by the next acquirer, when
 *   - the holder is in this container and its pid is gone (or was reused), or
 *   - the holder stopped refreshing for longer than staleAfterMs, or
 *   - it is older than maxHoldMs (longest legitimate run plus a margin).
 * An unreadable lock (for example a legacy or foreign file) is stale only once
 * its mtime is older than staleAfterMs, so a writer is never raced.
 *
 * Single source for both RXO worker images (copied into each src/lib).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_LOCK_BYTES = 4096;

export class LockBusyError extends Error {
  constructor(code, holder = null, file = '') {
    super(`${code}: ${describeHolder(holder)} holds ${path.basename(file)}`);
    this.name = 'LockBusyError';
    this.code = code;
    this.holder = holder;
  }
}

function describeHolder(holder) {
  if (!holder) return 'another process';
  const pid = Number.isInteger(holder.pid) ? `pid ${holder.pid}` : 'unknown pid';
  return `${holder.purpose || 'another process'} (${pid} on ${holder.host || 'unknown host'}, since ${holder.startedAt || 'unknown'})`;
}

const procAvailable = () => { try { fs.statSync('/proc/self/stat'); return true; } catch { return false; } };

/** Kernel start time (clock ticks since boot) of a pid, or null when unknown. */
export function processStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 22 (starttime); fields after the parenthesised command start at field 3.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] || null;
  } catch {
    return null;
  }
}

/** true = holder alive, false = holder dead, null = cannot tell (other container/host). */
export function holderAlive(holder, { host = os.hostname() } = {}) {
  if (!holder || holder.host !== host) return null;
  if (!Number.isInteger(holder.pid) || holder.pid <= 0) return false;
  if (holder.procStart && procAvailable()) {
    const current = processStartTime(holder.pid);
    return current !== null && current === holder.procStart;
  }
  try { process.kill(holder.pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function readLockFile(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) return { stat, raw: null, holder: null, invalid: true };
  let raw = null, holder = null;
  try {
    raw = stat.size <= MAX_LOCK_BYTES ? fs.readFileSync(file, 'utf8') : null;
    const value = raw === null ? null : JSON.parse(raw);
    if (value && value.contractVersion === 1 && typeof value.token === 'string') holder = value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
  }
  return { stat, raw, holder, invalid: !holder };
}

/** Classifies an existing lock file without changing it. */
export function inspectLock(file, { staleAfterMs, maxHoldMs, now = Date.now(), host = os.hostname() } = {}) {
  const current = readLockFile(file);
  if (!current) return { present: false, stale: false, reason: null, holder: null };
  const { stat, raw, holder, invalid } = current;
  const ageOf = value => now - Date.parse(value);
  let reason = null;
  if (invalid) {
    if (now - stat.mtimeMs > staleAfterMs) reason = 'UNREADABLE_LOCK_EXPIRED';
  } else {
    const alive = holderAlive(holder, { host });
    if (alive === false) reason = 'OWNER_NOT_RUNNING';
    else if (!(ageOf(holder.refreshedAt) <= staleAfterMs)) reason = 'OWNER_STOPPED_REFRESHING';
    else if (!(ageOf(holder.startedAt) <= maxHoldMs)) reason = 'MAX_HOLD_EXCEEDED';
  }
  return { present: true, stale: reason !== null, reason, holder, raw, ageMs: Math.max(0, now - stat.mtimeMs) };
}

function writeNew(file, content) {
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
  try {
    fs.linkSync(temp, file); // atomic create-if-absent with complete content
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
}

function sameLock(observed, current) {
  if (!current) return false;
  if (observed.holder && current.holder) return observed.holder.token === current.holder.token;
  return observed.raw !== null && observed.raw === current.raw;
}

/** Removes a lock judged stale, unless it changed since it was inspected. */
function breakStale(file, observed, log) {
  const aside = `${file}.stale-${randomUUID()}`;
  try { fs.renameSync(file, aside); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const moved = readLockFile(aside);
  if (!sameLock(observed, moved)) {
    // Another process replaced the stale lock in between: put the fresh lock back.
    try { fs.linkSync(aside, file); } catch {}
    try { fs.unlinkSync(aside); } catch {}
    return false;
  }
  fs.unlinkSync(aside);
  log(`[LOCK] Broke stale ${path.basename(file)} (${observed.reason}) held by ${describeHolder(observed.holder)}.`);
  return true;
}

/**
 * Takes the lock or throws LockBusyError(code). Returns a handle with
 * release(), refresh() and lost (true when another process broke the lock).
 */
export function acquireLock(file, {
  code = 'LOCK_BUSY',
  purpose = 'process',
  staleAfterMs = 120_000,
  maxHoldMs = 3_600_000,
  heartbeatMs = 0,
  log = message => console.log(message),
} = {}) {
  if (!(staleAfterMs > 0) || !(maxHoldMs > 0)) throw new Error('acquireLock requires positive staleAfterMs and maxHoldMs.');
  if (heartbeatMs && heartbeatMs * 2 >= staleAfterMs) throw new Error('Lock heartbeat must be well inside staleAfterMs.');
  const startedAt = new Date().toISOString();
  const holder = {
    contractVersion: 1, token: randomUUID(), purpose, pid: process.pid, host: os.hostname(),
    procStart: processStartTime(process.pid), startedAt, refreshedAt: startedAt,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeNew(file, JSON.stringify(holder) + '\n');
      return lockHandle(file, holder, heartbeatMs);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const observed = inspectLock(file, { staleAfterMs, maxHoldMs });
    if (!observed.present) continue;
    if (!observed.stale || !breakStale(file, observed, log)) throw new LockBusyError(code, observed.holder, file);
  }
  throw new LockBusyError(code, inspectLock(file, { staleAfterMs, maxHoldMs }).holder, file);
}

function lockHandle(file, holder, heartbeatMs) {
  let timer = null;
  const handle = {
    file, token: holder.token, lost: false, released: false,
    refresh() {
      if (handle.released || handle.lost) return false;
      const current = readLockFile(file);
      if (current?.holder?.token !== holder.token) { handle.lost = true; stop(); return false; }
      const next = { ...holder, refreshedAt: new Date().toISOString() };
      const temp = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(next) + '\n', { flag: 'wx', mode: 0o600 });
      try { fs.renameSync(temp, file); } finally { try { fs.unlinkSync(temp); } catch {} }
      return true;
    },
    release() {
      if (handle.released) return;
      handle.released = true;
      stop();
      const current = readLockFile(file);
      if (current?.holder?.token === holder.token) {
        try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    },
  };
  function stop() { if (timer) clearInterval(timer); timer = null; }
  if (heartbeatMs > 0) {
    timer = setInterval(() => { try { handle.refresh(); } catch {} }, heartbeatMs);
    timer.unref?.();
  }
  return handle;
}

/** Bounds an await. The underlying work keeps running; callers decide what a timeout means. */
export function withTimeout(promise, ms, code = 'OPERATION_TIMEOUT') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { const error = new Error(code); error.code = code; reject(error); }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
