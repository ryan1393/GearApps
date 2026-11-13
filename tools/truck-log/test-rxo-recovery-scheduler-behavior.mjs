// Actual scheduler functions and separate helper processes; no upstream RXO/browser calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { acquireLock, LockBusyError } from '../../libs/truck-log/rxo-shared/process-lock.mjs';
import * as auth from '../../libs/truck-log/rxo-shared/rxo-auth.mjs';
import * as manualScan from '../../apps/rxo-expedite/src/lib/manual-scan.mjs';
const ts = createRequire(import.meta.url)('typescript');
const authFile = 'libs/truck-log/rxo-shared/rxo-auth.mjs';
const moduleUrl = pathToFileURL(path.resolve(authFile)).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-recovery-schedulers-'));
const secrets = path.join(tmp, 'secrets');
fs.mkdirSync(secrets);
fs.writeFileSync(path.join(secrets, 'rxo_username'), 'recovery@example.test');
fs.writeFileSync(path.join(secrets, 'rxo_password'), 'local-test-password');
const generation = randomUUID();
const generationRoot = path.join(secrets, 'rxo_expedite_versions', generation);
fs.mkdirSync(generationRoot, { recursive: true });
fs.writeFileSync(path.join(secrets, 'rxo_expedite_current.json'), JSON.stringify({ contractVersion: 1, generation }));
fs.writeFileSync(path.join(generationRoot, 'rxo_expedite_username'), 'recovery@example.test');
fs.writeFileSync(path.join(generationRoot, 'rxo_expedite_password'), 'local-test-password');
const fixtureEnvironment = { RXO_SECRET_ROOT: secrets, RXO_USERNAME_FILE: path.join(secrets, 'rxo_username'), RXO_PASSWORD_FILE: path.join(secrets, 'rxo_password') };
const savedEnvironment = Object.fromEntries(Object.keys(fixtureEnvironment).map(key => [key, process.env[key]]));
Object.assign(process.env, fixtureEnvironment);
const json = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
function hold(root, role, code = 'RXO_AUTH_NAVIGATION_REVIEW') {
  fs.writeFileSync(path.join(root, 'rxo-auth-review.json'), JSON.stringify({
    version: auth.AUTH_VERSION, role, code, phase: 'FAILED', passwordSubmissions: 0,
    message: 'Navigation could not be verified', updatedAt: new Date().toISOString(),
    credentialVersion: auth.currentCredentialVersion(role, root),
  }));
}
function fixture(role, name) {
  const root = path.join(tmp, name);
  fs.mkdirSync(root);
  hold(root, role);
  return root;
}
function ageRecovery(root) {
  const record = json(root, 'rxo-connection-recovery.json');
  record.requestedAt = new Date(Date.now() - 61_000).toISOString();
  if (record.deliveryRequestedAt) record.deliveryRequestedAt = record.requestedAt;
  fs.writeFileSync(path.join(root, 'rxo-connection-recovery.json'), JSON.stringify(record));
  return record;
}
function child(root, role, operation) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e',
      `import {${operation}} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(${operation}(${JSON.stringify(root)},${JSON.stringify(role)})));`,
    ], { env: { ...process.env, RXO_SECRET_ROOT: secrets }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    proc.stdout.on('data', chunk => { output += chunk; });
    proc.stderr.on('data', chunk => { error += chunk; });
    proc.on('error', reject);
    proc.on('exit', code => code ? reject(Error(error || 'Recovery helper failed')) : resolve(JSON.parse(output.trim())));
  });
}
// AST extraction executes the shipped function body without importing browser/worker entrypoints.
function fn(file, name) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert(node, 'Missing production function ' + name);
  return node.getText(source);
}
async function metadataHelpers() {
  // Export private helpers from an in-memory copy: real lock/filesystem logic,
  // unchanged production files, and no browser-worker entrypoint side effects.
  const authUrl = pathToFileURL(path.resolve(authFile)).href;
  const lockUrl = pathToFileURL(path.resolve('libs/truck-log/rxo-shared/process-lock.mjs')).href;
  const source = fs.readFileSync(authFile, 'utf8')
    .replace("from './process-lock.mjs'", 'from ' + JSON.stringify(lockUrl))
    .replaceAll('import.meta.url', JSON.stringify(authUrl));
  return import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {consumeSessionRefresh,completeRecovery};').toString('base64'));
}

let passed = 0;
async function test(name, action) { await action(); passed++; console.log('[PASS] ' + name); }
try {
  for (const role of ['standard', 'expedite']) {
    await test(`${role}: concurrent requests coalesce and separate consumers authorize exactly one scan`, async () => {
      const root = fixture(role, 'concurrent-' + role);
      const requested = await Promise.all(Array.from({ length: 8 }, () => child(root, role, 'requestConnectionRecovery')));
      assert.equal(requested.filter(result => result.requested).length, 1);
      const record = json(root, 'rxo-connection-recovery.json'), pending = json(root, 'rxo-auth-retry.json');
      assert.equal(record.attempts.length, 1);
      assert.equal(record.id, pending.id);
      const consumed = await Promise.all(Array.from({ length: 8 }, () => child(root, role, 'consumeAuthRetry')));
      assert.equal(consumed.filter(Boolean).length, 1);
      assert.equal(fs.existsSync(path.join(root, 'rxo-auth-retry.json')), false);
      assert.equal(json(root, 'rxo-connection-recovery.json').phase, 'RUNNING');
      assert.equal(auth.readAuthHold(root, role), null);
    });
  }
  await test('legacy Run Scan Now cannot bypass the three-per-hour recovery cap', () => {
    const root = fixture('standard', 'legacy-limit');
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(auth.authorizeManualRetry(root, 'standard'), true);
      assert.equal(json(root, 'rxo-connection-recovery.json').attempts.length, attempt + 1);
      ageRecovery(root);
      hold(root, 'standard');
    }
    assert.equal(auth.authorizeManualRetry(root, 'standard'), false);
    assert(auth.readAuthHold(root, 'standard'));
  });
  await test('a queued third request stays deliverable at the cap without adding another attempt', () => {
    const root = fixture('standard', 'queued-at-cap');
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(auth.requestConnectionRecovery(root, 'standard').requested, true);
      if (attempt < 2) {
        assert.equal(auth.consumeAuthRetry(root, 'standard'), true);
        hold(root, 'standard');
      }
      ageRecovery(root);
    }
    assert.equal(auth.requestConnectionRecovery(root, 'standard').requested, true);
    assert.equal(json(root, 'rxo-connection-recovery.json').attempts.length, 3);
    assert.equal(auth.consumeAuthRetry(root, 'standard'), true);
    assert.equal(json(root, 'rxo-connection-recovery.json').attempts.length, 3);
    assert.equal(auth.consumeAuthRetry(root, 'standard'), false);
    hold(root, 'standard');
    assert.equal(auth.requestConnectionRecovery(root, 'standard').requested, false);
  });
  await test('stale worker completion and refresh cannot mutate a newer running recovery', async () => {
    const root = fixture('standard', 'stale-worker');
    auth.requestConnectionRecovery(root, 'standard');
    assert.equal(auth.consumeAuthRetry(root, 'standard'), true);
    const oldId = ageRecovery(root).id;
    assert.equal(auth.requestConnectionRecovery(root, 'standard').requested, true);
    assert.equal(auth.consumeAuthRetry(root, 'standard'), true);
    const next = json(root, 'rxo-connection-recovery.json');
    assert.notEqual(next.id, oldId);
    const context = await metadataHelpers();
    assert.equal(await context.consumeSessionRefresh(root, 'standard', oldId), false);
    await context.completeRecovery(root, 'standard', oldId, 'AUTHENTICATED');
    const unchanged = json(root, 'rxo-connection-recovery.json');
    assert.equal(unchanged.id, next.id);
    assert.equal(unchanged.phase, 'RUNNING');
    assert.equal(unchanged.refreshSession, true);
    assert.equal(unchanged.attempts.length, 2);
    assert.equal(await context.consumeSessionRefresh(root, 'standard', next.id), true);
    assert.equal(await context.consumeSessionRefresh(root, 'standard', next.id), false);
    const lock = acquireLock(path.join(root, '.rxo-connection-recovery.lock'), {
      staleAfterMs: 30_000, maxHoldMs: 30_000, log() {},
    });
    const completion = context.completeRecovery(root, 'standard', next.id, 'AUTHENTICATED');
    assert.equal(json(root, 'rxo-connection-recovery.json').phase, 'RUNNING');
    setTimeout(() => lock.release(), 40);
    await completion;
    assert.equal(json(root, 'rxo-connection-recovery.json').phase, 'AUTHENTICATED');
  });
  await test('completion holds the same lock as helpers, preventing a lost accepted request', async () => {
    const root = fixture('standard', 'completion-helper-race');
    auth.requestConnectionRecovery(root, 'standard');
    auth.consumeAuthRetry(root, 'standard');
    const recovery = ageRecovery(root);
    const context = await metadataHelpers();
    const originalRead = fs.readFileSync;
    let racingRequest, injected = false;
    fs.readFileSync = function (file, ...options) {
      const result = originalRead.call(fs, file, ...options);
      if (!injected && String(file) === path.join(root, 'rxo-connection-recovery.json')) {
        injected = true;
        racingRequest = auth.requestConnectionRecovery(root, 'standard');
      }
      return result;
    };
    try { await context.completeRecovery(root, 'standard', recovery.id, 'AUTHENTICATED'); }
    finally { fs.readFileSync = originalRead; }
    assert.equal(racingRequest.requested, false);
    assert.equal(auth.requestConnectionRecovery(root, 'standard').requested, true);
    const next = json(root, 'rxo-connection-recovery.json'), pending = json(root, 'rxo-auth-retry.json');
    assert.notEqual(next.id, recovery.id);
    assert.equal(next.id, pending.id);
    assert.equal(next.phase, 'QUEUED');
    assert.equal(next.attempts.length, 2);
  });
  for (const held of [true, false]) await test(`Standard startup consumes recovery before work (existing hold=${held})`, async () => {
    const root = fixture('standard', 'standard-startup-' + held);
    if (!held) fs.unlinkSync(path.join(root, 'rxo-auth-review.json'));
    auth.requestConnectionRecovery(root, 'standard');
    let scans = 0, manual = held, consumedManual = 0, context;
    const pendingAtWork = [];
    const file = 'apps/rxo-integration/src/rxo-scheduler.mjs';
    context = vm.createContext({ ...manualScan, fs, Date, console: { log() {}, error() {} }, DATA_DIR: root,
      SYNC_ON_START: true, LOOP_IDLE_BOUND_MS: 120000, HEARTBEAT_MS: 5000,
      setInterval: () => ({ unref() {} }), clearInterval() {}, currentSettings: () => ({ syncIntervalMinutes: 30 }),
      publishScheduler() {}, markLoopProgress() {}, readManualRequest: () => manual ? { id: 'coalesced-rescan' } : null,
      consumeManualRequest: () => { manual = false; consumedManual++; }, authCall: (_label, op) => op(),
      consumeAuthRetry: auth.consumeAuthRetry, hasPendingAuthRetry: auth.hasPendingAuthRetry, authorizeManualRetry: auth.authorizeManualRetry,
      consumeCredentialChangeRetry: auth.consumeCredentialChangeRetry,
      readAuthState: () => ({ hold: auth.readAuthHold(root, 'standard'), error: false }), notifyAuthFailure: async () => {},
      runExporter: async () => {
        pendingAtWork.push(fs.existsSync(path.join(root, 'rxo-auth-retry.json')));
        scans++; hold(root, 'standard');
      },
      sleep: async () => { vm.runInContext('shuttingDown=true', context); },
    });
    await vm.runInContext(`let shuttingDown=false;const schedulerState={currentPhase:'WAITING'};\n${fn(file, 'waitForTrigger')}\n${fn(file, 'main')}\nmain()`, context);
    assert.equal(scans, 1);
    assert.deepEqual(pendingAtWork, [false], 'Recovery must be consumed before startup work');
    assert.equal(consumedManual, held ? 1 : 0);
    assert(auth.readAuthHold(root, 'standard'));
    assert.equal(fs.existsSync(path.join(root, 'rxo-auth-retry.json')), false);
  });
  for (const syncOnStart of [true, false]) for (const held of [true, false]) {
    await test(`Expedite startup consumes recovery before work (syncOnStart=${syncOnStart}, existing hold=${held})`, async () => {
      const root = fixture('expedite', 'expedite-startup-' + syncOnStart + '-' + held);
      if (!held) fs.unlinkSync(path.join(root, 'rxo-auth-review.json'));
      auth.requestConnectionRecovery(root, 'expedite');
      const file = 'apps/rxo-expedite/src/scheduler.mjs';
      let scans = 0, context;
      const pendingAtWork = [];
      context = vm.createContext({ ...manualScan, fs, Date, console: { log() {}, error() {} }, DATA_ROOT: root, state: {},
        LOOP_MARGIN_MS: 1, MAX_ACQUISITION_MS: 10000, AUTH_NOTIFICATION_TIMEOUT_MS: 1000,
        setInterval: () => ({ unref() {} }), clearInterval() {},
        readSettings: () => ({ intervalMinutes: 30, syncOnStart }), markLoop() {}, write() {},
        authCall: op => { try { return { value: op(), error: null }; } catch (error) { return { value: false, error: error.code }; } },
        consumeAuthRetry: auth.consumeAuthRetry, hasPendingAuthRetry: auth.hasPendingAuthRetry, consumeCredentialChangeRetry: auth.consumeCredentialChangeRetry,
        readAuthHold: auth.readAuthHold, acquireOnce: async () => {
          pendingAtWork.push(fs.existsSync(path.join(root, 'rxo-auth-retry.json')));
          scans++; hold(root, 'expedite'); throw Error('Test failure');
        },
        browserCloseTimedOut: () => false, errorCode: () => 'TEST_FAILURE', chromium: {},
        notifyAuthFailure: async () => {}, sleep: async () => { vm.runInContext('stopping=true', context); }, process: { exitCode: 0 },
      });
      await vm.runInContext(`let stopping=false,running=false,heartbeat=null;\n${fn(file, 'runOne')}\n${fn(file, 'waitForNext')}\n${fn(file, 'main')}\nmain()`, context);
      assert.equal(scans, 1);
      assert.deepEqual(pendingAtWork, [false], 'Recovery must be consumed before startup work');
      assert(auth.readAuthHold(root, 'expedite'));
      assert.equal(fs.existsSync(path.join(root, 'rxo-auth-retry.json')), false);
    });
  }
  for (const role of ['standard', 'expedite']) for (const obstruction of ['busy lock', 'malformed request']) {
    await test(`${role}: ${obstruction} cannot fall through to an ordinary startup scan`, async () => {
      const root = fixture(role, 'startup-blocked-' + role + '-' + obstruction.replace(' ', '-'));
      fs.unlinkSync(path.join(root, 'rxo-auth-review.json'));
      auth.requestConnectionRecovery(root, role);
      const retryPath = path.join(root, 'rxo-auth-retry.json');
      if (obstruction === 'malformed request') fs.writeFileSync(retryPath, '{malformed');
      const lock = obstruction === 'busy lock' ? acquireLock(path.join(root, '.rxo-connection-recovery.lock'), {
        staleAfterMs: 30_000, maxHoldMs: 30_000, log() {},
      }) : null;
      let scans = 0, context;
      const errors = [];
      const run = async () => { scans++; throw Error('Startup work should stay blocked'); };
      try {
        if (role === 'standard') {
          const file = 'apps/rxo-integration/src/rxo-scheduler.mjs';
          context = vm.createContext({ ...manualScan, fs, Date, console: { log() {}, error() {} }, DATA_DIR: root,
            SYNC_ON_START: true, LOOP_IDLE_BOUND_MS: 120000, HEARTBEAT_MS: 5000,
            setInterval: () => ({ unref() {} }), clearInterval() {}, currentSettings: () => ({ syncIntervalMinutes: 30 }),
            publishScheduler() {}, markLoopProgress() {}, readManualRequest: () => null, consumeManualRequest() {},
            authCall: (_label, op, fallback) => { try { return op(); } catch (error) { errors.push(error.code); return fallback; } },
            consumeAuthRetry: auth.consumeAuthRetry, hasPendingAuthRetry: auth.hasPendingAuthRetry,
            authorizeManualRetry: auth.authorizeManualRetry, consumeCredentialChangeRetry: auth.consumeCredentialChangeRetry,
            readAuthState: () => ({ hold: auth.readAuthHold(root, role), error: false }), notifyAuthFailure: async () => {},
            runExporter: run, sleep: async () => { vm.runInContext('shuttingDown=true', context); },
          });
          await vm.runInContext(`let shuttingDown=false;const schedulerState={currentPhase:'WAITING'};\n${fn(file, 'waitForTrigger')}\n${fn(file, 'main')}\nmain()`, context);
        } else {
          const file = 'apps/rxo-expedite/src/scheduler.mjs';
          context = vm.createContext({ ...manualScan, fs, Date, console: { log() {}, error() {} }, DATA_ROOT: root, state: {},
            LOOP_MARGIN_MS: 1, MAX_ACQUISITION_MS: 10000, AUTH_NOTIFICATION_TIMEOUT_MS: 1000,
            setInterval: () => ({ unref() {} }), clearInterval() {}, readSettings: () => ({ intervalMinutes: 30, syncOnStart: true }),
            markLoop() {}, write() {}, authCall: op => { try { return { value: op(), error: null }; } catch (error) { errors.push(error.code); return { value: false, error: error.code }; } },
            consumeAuthRetry: auth.consumeAuthRetry, hasPendingAuthRetry: auth.hasPendingAuthRetry,
            consumeCredentialChangeRetry: auth.consumeCredentialChangeRetry, readAuthHold: auth.readAuthHold,
            acquireOnce: run, browserCloseTimedOut: () => false, errorCode: () => 'TEST_FAILURE', chromium: {},
            notifyAuthFailure: async () => {}, sleep: async () => { vm.runInContext('stopping=true', context); }, process: { exitCode: 0 },
          });
          await vm.runInContext(`let stopping=false,running=false,heartbeat=null;\n${fn(file, 'runOne')}\n${fn(file, 'waitForNext')}\n${fn(file, 'main')}\nmain()`, context);
        }
        assert.equal(scans, 0);
        assert.equal(fs.existsSync(retryPath), true, 'The unconsumed request must remain available for review/retry');
        if (obstruction === 'malformed request') {
          assert.equal(fs.readFileSync(retryPath, 'utf8'), '{malformed');
          assert(errors.includes('RXO_AUTH_STATE_REVIEW'));
        }
      } finally { lock?.release(); }
    });
  }
  console.log(`[PASS] Recovery scheduler and cross-process behavior: ${passed} cases.`);
} finally {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
