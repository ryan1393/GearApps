// Real queue/lock files and shipped scheduler functions; no RXO/browser/network calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as manual from '../../../apps/rxo-expedite/src/lib/manual-scan.mjs';
import * as auth from '../../../libs/truck-log/rxo-shared/rxo-auth.mjs';
import { saveCredentials } from '../../../apps/rxo-expedite/src/lib/credentials.mjs';
import { acquireLock } from '../../../libs/truck-log/rxo-shared/process-lock.mjs';

const ts = createRequire(import.meta.url)('typescript');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-expedite-manual-'));
const secretRoot = path.join(tmp, 'secrets');
fs.mkdirSync(secretRoot);
saveCredentials({ username: 'test@example.test', password: 'fixture-private-password' }, secretRoot);
const savedSecrets = process.env.RXO_SECRET_ROOT;
process.env.RXO_SECRET_ROOT = secretRoot;
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function fixture(name) {
  const root = path.join(tmp, name);
  fs.mkdirSync(root);
  scheduler(root);
  return root;
}
function scheduler(root, extra = {}) {
  fs.writeFileSync(path.join(root, 'expedite-scheduler-status.json'), JSON.stringify({
    source: 'RXO_EXPEDITE', schedulerState: 'WAITING', schedulerHeartbeatAt: new Date().toISOString(),
    schedulerLoopDeadlineAt: new Date(Date.now() + 120000).toISOString(), ...extra,
  }));
}
function hold(root) {
  fs.writeFileSync(path.join(root, 'rxo-auth-review.json'), JSON.stringify({ version: auth.AUTH_VERSION,
    role: 'expedite', code: 'RXO_AUTH_NAVIGATION_REVIEW', phase: 'FAILED', passwordSubmissions: 0,
    updatedAt: new Date().toISOString(), message: 'Synthetic navigation failure',
  }));
}
function fn(name) {
  const file = 'apps/rxo-expedite/src/scheduler.mjs';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = source.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === name);
  assert(node, name);
  return node.getText(source);
}
function environment(root, acquireOnce, overrides = {}) {
  const context = vm.createContext({ ...manual, ...auth, fs, Date, DATA_ROOT: root,
    console: { log() {}, error() {} }, LOOP_MARGIN_MS: 1, MAX_ACQUISITION_MS: 10000,
    AUTH_NOTIFICATION_TIMEOUT_MS: 1000, setInterval: () => ({ unref() {} }), clearInterval() {},
    readSettings: () => ({ intervalMinutes: 30, syncOnStart: false }), markLoop() {}, write() {},
    authCall: operation => { try { return { value: operation(), error: null }; } catch { return { value: null, error: 'STATE_REVIEW' }; } },
    acquireOnce, browserCloseTimedOut: () => false, errorCode: error => error.code || 'TEST_FAILURE',
    chromium: {}, notifyAuthFailure: async () => {}, process: { exitCode: 0 },
    sleep: async () => { vm.runInContext('stopping=true', context); }, ...overrides,
  });
  vm.runInContext(`let stopping=false,running=false,heartbeat=null;const state={};\n${fn('runOne')}\n${fn('waitForNext')}\n${fn('main')}`, context);
  return context;
}
function child(root) {
  const moduleUrl = pathToFileURL(path.resolve('apps/rxo-expedite/src/lib/manual-scan.mjs')).href;
  const script = `import {requestManualScan} from ${JSON.stringify(moduleUrl)};let value;for(let i=0;i<50;i++){value=requestManualScan(${JSON.stringify(root)});if(value.errorCode!=='REQUEST_BUSY')break;await new Promise(r=>setTimeout(r,5));}console.log(JSON.stringify(value));`;
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', script], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    proc.stdout.on('data', value => output += value);
    proc.stderr.on('data', value => errors += value);
    proc.on('error', reject);
    proc.on('exit', code => code ? reject(Error(errors)) : resolve(JSON.parse(output)));
  });
}
let passed = 0;
async function test(name, action) { await action(); passed++; console.log('[PASS] ' + name); }
try {
  await test('concurrent requests coalesce to one persisted scan and one scheduler export', async () => {
    const root = fixture('concurrent');
    const requests = await Promise.all(Array.from({ length: 8 }, () => child(root)));
    assert(requests.every(value => value.accepted));
    assert.equal(new Set(requests.map(value => value.manualRun.id)).size, 1);
    let scans = 0;
    const context = environment(root, async () => {
      scans++;
      assert.equal(manual.readManualScan(root).status, 'RUNNING');
      assert.equal(manual.requestManualScan(root).manualRun.id, requests[0].manualRun.id);
      return { sourceBatchId: '20261110T170000000Z-12345678-1234-4234-8234-123456789abc' };
    });
    await vm.runInContext('runOne()', context);
    assert.equal(scans, 1);
    const result = manual.readManualScan(root);
    assert.equal(result.status, 'COMPLETE');
    assert(result.startedAt && result.completedAt && result.sourceBatchId);
    assert.equal(result.error, null);
  });
  await test('queued work wakes a scheduler with sync-on-start disabled without waiting for interval', async () => {
    const root = fixture('wake');
    assert(manual.requestManualScan(root).accepted);
    let scans = 0, sleeps = 0;
    const context = environment(root, async () => { scans++; return {}; }, {
      sleep: async () => { sleeps++; vm.runInContext('stopping=true', context); },
    });
    await vm.runInContext('main()', context);
    assert.equal(scans, 1);
    assert.equal(sleeps, 1, 'Only the post-export wait should sleep');
    assert.equal(manual.readManualScan(root).status, 'COMPLETE');
  });
  await test('failed acquisition records a terminal error without native diagnostics or successful batch', async () => {
    const root = fixture('failed');
    const request = manual.requestManualScan(root);
    const context = environment(root, async () => { throw Object.assign(Error('fixture-private-password'), { code: 'EXPEDITE_ACQUISITION_FAILED' }); });
    await vm.runInContext('runOne()', context);
    const result = manual.readManualScan(root);
    assert.equal(result.id, request.manualRun.id);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.error, 'EXPEDITE_ACQUISITION_FAILED');
    assert.equal(result.sourceBatchId, null);
    assert(!JSON.stringify(result).includes('fixture-private-password'));
  });
  await test('auth hold arriving after acceptance fails the queue without opening a browser', async () => {
    const root = fixture('hold-race');
    assert(manual.requestManualScan(root).accepted);
    hold(root);
    let scans = 0;
    await vm.runInContext('runOne()', environment(root, async () => { scans++; }));
    assert.equal(scans, 0);
    assert.equal(manual.readManualScan(root).status, 'FAILED');
    assert.equal(manual.readManualScan(root).error, 'AUTH_REVIEW');
    assert(auth.readAuthHold(root, 'expedite'));
  });
  await test('scheduler unavailable, busy, stale and held states cannot create manual work', () => {
    for (const [name, extra, errorCode] of [
      ['stale', { schedulerHeartbeatAt: new Date(Date.now() - 100000).toISOString() }, 'SCHEDULER_UNAVAILABLE'],
      ['expired', { schedulerLoopDeadlineAt: new Date(Date.now() - 1).toISOString() }, 'SCHEDULER_UNAVAILABLE'],
      ['stopped', { schedulerState: 'STOPPED' }, 'SCHEDULER_UNAVAILABLE'],
      ['busy', { schedulerState: 'EXPORTING' }, 'SCHEDULER_BUSY'],
    ]) {
      const root = fixture(name); scheduler(root, extra);
      assert.equal(manual.requestManualScan(root).errorCode, errorCode);
      assert.equal(manual.readManualScan(root), null);
    }
    const root = fixture('held'); hold(root);
    assert.equal(manual.requestManualScan(root).errorCode, 'AUTH_REVIEW');
    assert.equal(manual.readManualScan(root), null);
  });
  await test('recovery queue/cooldown and retry cap cannot be bypassed by Scan Now', () => {
    const root = fixture('recovery');
    assert(auth.requestConnectionRecovery(root, 'expedite').requested);
    assert.equal(manual.requestManualScan(root).errorCode, 'RECOVERY_PENDING');
    assert(auth.consumeAuthRetry(root, 'expedite'));
    assert.equal(manual.requestManualScan(root).errorCode, 'COOLDOWN');
    const file = path.join(root, 'rxo-connection-recovery.json'), record = json(file);
    const at = new Date(Date.now() - 61000).toISOString();
    fs.writeFileSync(file, JSON.stringify({ ...record, requestedAt: at, deliveryRequestedAt: at,
      attempts: [at, at, at], phase: 'AUTHENTICATED' }));
    assert.equal(manual.requestManualScan(root).errorCode, 'RETRY_LIMIT');
    assert.equal(manual.readManualScan(root), null);
  });
  await test('restarted scheduler fails an orphan running request instead of replaying it', () => {
    const root = fixture('interrupted');
    const request = manual.requestManualScan(root);
    manual.startManualScan(root);
    manual.interruptManualScan(root);
    const result = manual.readManualScan(root);
    assert.equal(result.id, request.manualRun.id);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.error, 'EXPEDITE_SCAN_INTERRUPTED');
    assert.equal(manual.startManualScan(root), null);
  });
  await test('completion survives concurrent request-lock contention and does not rerun the export', async () => {
    const root = fixture('completion-lock');
    const request = manual.requestManualScan(root);
    let scans = 0;
    const context = environment(root, async () => {
      scans++;
      const lock = acquireLock(path.join(root, '.expedite-manual-scan.lock'), { staleAfterMs: 30000, maxHoldMs: 30000, log() {} });
      setTimeout(() => lock.release(), 1250);
      return {};
    });
    await vm.runInContext('runOne()', context);
    assert.equal(scans, 1);
    assert.equal(manual.readManualScan(root).id, request.manualRun.id);
    assert.equal(manual.readManualScan(root).status, 'COMPLETE');
  });
  await test('terminal metadata failure requests scheduler restart without relabeling a successful export as failed', async () => {
    const root = fixture('completion-storage-failure');
    assert(manual.requestManualScan(root).accepted);
    const context = environment(root, async () => ({}), { finishManualScan: async () => { throw Error('Synthetic storage failure'); } });
    await vm.runInContext('runOne()', context);
    assert.equal(vm.runInContext('stopping', context), true);
    assert.equal(vm.runInContext('process.exitCode', context), 75);
    assert.equal(vm.runInContext('state.schedulerState', context), 'STOPPING');
    assert(vm.runInContext('!!state.lastSuccessAt', context));
    assert.equal(vm.runInContext('state.lastFailureAt', context), undefined);
    assert.equal(manual.readManualScan(root).status, 'RUNNING');
    manual.interruptManualScan(root);
    assert.equal(manual.readManualScan(root).status, 'FAILED');
    assert.equal(manual.readManualScan(root).error, 'EXPEDITE_SCAN_INTERRUPTED');
  });
  await test('malformed and symlink control state fails closed and raw fields never escape', () => {
    const root = fixture('malformed'), file = path.join(root, 'expedite-manual-scan.json');
    fs.writeFileSync(file, '{private');
    assert.equal(manual.requestManualScan(root).errorCode, 'STATE_REVIEW');
    fs.unlinkSync(file);
    const outside = path.join(tmp, 'outside'); fs.writeFileSync(outside, 'unchanged'); fs.symlinkSync(outside, file);
    assert.equal(manual.requestManualScan(root).errorCode, 'STATE_REVIEW');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
  });
  console.log(`[PASS] Expedite manual scans: ${passed} cases.`);
} finally {
  if (savedSecrets === undefined) delete process.env.RXO_SECRET_ROOT; else process.env.RXO_SECRET_ROOT = savedSecrets;
  fs.rmSync(tmp, { recursive: true, force: true });
}
