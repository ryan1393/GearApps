import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const rxjs = require('rxjs');
const { TestScheduler } = require('rxjs/testing');
const decorator = () => value => value;
const mocks = {
  '@angular/core': { Component: decorator, Injectable: decorator, inject: () => ({}) },
  '@angular/common': {}, '@angular/router': {}, '@angular/common/http': {},
  '@truck-log/web/auth/admin': {}, '@truck-log/shared/contracts': {},
  '@truck-log/web/data-access': {}, '@truck-log/web/ui': { rememberedFlag: (_key, fallback) => ({ get: () => fallback, set() {} }), jumpToSection() {} },
  './rxo-data.store': {}, './rxo-data-table.component': {},
  './rxo-settings-panel.component': { emptyRxoSettingsForm: () => ({}), applyRxoSettings() {} },
  './rxo-expedite/rxo-expedite.component': {}, './rxo-expedite/rxo-expedite.store': {},
  rxjs,
};
function load(file, extraMocks = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require(name) {
      const dependencies = { ...mocks, ...extraMocks };
      assert(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
    window: { dispatchEvent() {}, clearInterval() {} }, CustomEvent: class {},
  }, { filename: file });
  return module.exports;
}
const feature = 'libs/truck-log/web/feature';
const scanModule = load(`${feature}/rxo-expedite-control-center/src/lib/rxo-expedite/expedite-scan-action.ts`);
const { ExpediteScanAction } = scanModule;
const run = (status = 'QUEUED', overrides = {}) => ({
  id: 'manual-1', status, requestedAt: new Date(Date.now() - 1000).toISOString(),
  startedAt: null, completedAt: null, error: null, sourceBatchId: null, ...overrides,
});
function readyStatus() {
  const now = Date.now();
  return {
    source: 'RXO_EXPEDITE', schedulingEnabled: true, manualRun: null,
    credentials: { username: 'operator', usernameConfigured: true, passwordConfigured: true, configured: true },
    acquisition: { state: 'COMPLETE', sourceBatchId: 'retained-verified-batch' },
    recovery: { requiresCredentials: false, requiresInteractiveLogin: false, cooldownUntil: null },
    scheduler: {
      state: 'WAITING', schedulerHeartbeatAt: new Date(now).toISOString(),
      nextRunAt: new Date(now + 30 * 60000).toISOString(),
    },
  };
}
function fixture() {
  let admin = true, requests = 0, refreshes = 0;
  const response = new rxjs.Subject();
  const store = { status: readyStatus(), stale: false, statusReceivedAt: Date.now(), refresh() { refreshes++; } };
  const auth = { canWrite: () => admin };
  const api = { runRxoExpediteScanNow() { requests++; return response; } };
  const action = new ExpediteScanAction(api, auth, store);
  return {
    action, response, store, auth, api, setAdmin(value) { admin = value; },
    get requests() { return requests; }, get refreshes() { return refreshes; },
  };
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`[PASS] ${name}`); }

test('Expedite: an operator cannot submit an administrator scan request', () => {
  const f = fixture(); f.setAdmin(false);
  assert.match(f.action.disabledReason, /administrator/);
  f.action.start(); assert.equal(f.requests, 0); assert.equal(f.action.run, null);
});
test('Expedite: duplicate clicks submit one pending request and keep the verified batch', () => {
  const f = fixture(), previousStatus = f.store.status;
  assert.equal(f.action.disabledReason, '');
  f.action.start(); f.action.start();
  assert.equal(f.requests, 1); assert.equal(f.action.requesting, true);
  assert.equal(f.action.label, 'Requesting scan…');
  assert.equal(f.store.status, previousStatus);
  assert.equal(f.store.status.acquisition.sourceBatchId, 'retained-verified-batch');
});
test('Expedite: a confirmed queued request remains visible across an older in-flight status poll', () => {
  const f = fixture(), queued = run();
  f.action.start(); f.response.next(queued); f.response.complete();
  assert.equal(f.action.requesting, false); assert.equal(f.refreshes, 1);
  assert.equal(f.action.run, queued); assert.equal(f.action.active, true);
  assert.match(f.action.message, /queued/); assert.doesNotMatch(f.action.message, /completed|imported/);
  f.store.status = { ...readyStatus(), manualRun: run('COMPLETE', { id: 'older-run', requestedAt: new Date(Date.now() - 60000).toISOString() }) };
  assert.equal(f.action.run, queued);
  f.action.start(); assert.equal(f.requests, 1);
});
test('Expedite: status polling tracks RUNNING then verified COMPLETE without claiming database import', () => {
  const f = fixture(), queued = run(); f.action.start(); f.response.next(queued); f.response.complete();
  const running = { ...queued, status: 'RUNNING', startedAt: new Date().toISOString() };
  f.store.status = { ...readyStatus(), manualRun: running };
  assert.equal(f.action.run, running); assert.equal(f.action.active, true);
  assert.match(f.action.label, /queued \/ running/); assert.match(f.action.message, /previous verified batch/);
  const complete = { ...running, status: 'COMPLETE', completedAt: new Date().toISOString(), sourceBatchId: 'new-verified-batch' };
  f.store.status = { ...readyStatus(), manualRun: complete };
  assert.equal(f.action.run, complete); assert.equal(f.action.active, false);
  assert.equal(f.action.disabledReason, ''); assert.equal(f.action.label, 'Run Scan Now');
  assert.match(f.action.message, /export completed and verified/);
  assert.match(f.action.message, /Latest import for database progress/);
  assert.equal(f.store.status.acquisition.sourceBatchId, 'retained-verified-batch');
});
test('Expedite: a failed polled run shows failure and keeps prior batch information', () => {
  const f = fixture(), queued = run(); f.action.start(); f.response.next(queued); f.response.complete();
  f.store.status = { ...readyStatus(), manualRun: { ...queued, status: 'FAILED', error: 'Expedite export did not produce a verified download.' } };
  assert.equal(f.action.active, false); assert.match(f.action.message, /did not produce a verified download/);
  assert.doesNotMatch(f.action.message, /completed and verified/);
  f.store.status.manualRun.error = null;
  assert.match(f.action.message, /previous verified batch stays available/);
  assert.equal(f.store.status.acquisition.sourceBatchId, 'retained-verified-batch');
});
test('Expedite: another newer run from status supersedes a locally accepted older request', () => {
  const f = fixture(), queued = run(); f.action.start(); f.response.next(queued); f.response.complete();
  const newer = run('RUNNING', { id: 'manual-2', requestedAt: new Date().toISOString() });
  f.store.status = { ...readyStatus(), manualRun: newer };
  assert.equal(f.action.run, newer); assert.equal(f.action.active, true);
});
for (const [label, response] of [
  ['missing body', null], ['unrelated success', { status: 'OK' }],
  ['standard RXO response', run('EXPORTING')], ['empty ID', run('QUEUED', { id: '' })],
  ['invalid timestamp', run('QUEUED', { requestedAt: 'not a date' })],
]) {
  test(`Expedite: ${label} does not create false queued or completion feedback`, () => {
    const f = fixture(); f.action.start(); f.response.next(response); f.response.complete();
    assert.equal(f.action.requesting, false); assert.equal(f.action.run, null); assert.equal(f.action.message, '');
    assert.match(f.action.error, /not confirmed/); assert.equal(f.refreshes, 1);
    f.action.start(); assert.equal(f.requests, 1);
    f.store.status = readyStatus(); f.store.statusReceivedAt = Date.now();
    assert.equal(f.action.disabledReason, '');
  });
}
test('Expedite: an ambiguous timed-out request blocks retry until newly fetched status arrives', () => {
  const f = fixture(); f.action.start();
  f.response.error(new rxjs.TimeoutError());
  assert.equal(f.action.requesting, false); assert.match(f.action.error, /not confirmed/);
  assert.match(f.action.disabledReason, /Refresh status to confirm/); assert.equal(f.refreshes, 1);
  f.action.start(); assert.equal(f.requests, 1);
  f.store.status = { ...readyStatus(), manualRun: run('RUNNING') };
  assert.match(f.action.disabledReason, /already queued or running/);
  f.store.status = readyStatus(); f.store.statusReceivedAt = Date.now();
  assert.equal(f.action.disabledReason, '');
});
for (const [label, change] of [
  ['active scheduled export', f => { f.store.status.scheduler.state = 'EXPORTING'; }],
  ['queued manual scan', f => { f.store.status.manualRun = run(); }],
  ['running manual scan', f => { f.store.status.manualRun = run('RUNNING'); }],
  ['authentication hold', f => { f.store.status.scheduler.state = 'AUTH_HELD'; }],
  ['stopped scheduler', f => { f.store.status.scheduler.state = 'STOPPED'; }],
  ['disabled scheduling', f => { f.store.status.schedulingEnabled = false; }],
  ['missing credentials', f => { f.store.status.credentials.configured = false; }],
  ['rejected credentials', f => { f.store.status.recovery.requiresCredentials = true; }],
  ['interactive login required', f => { f.store.status.recovery.requiresInteractiveLogin = true; }],
  ['recovery cooldown', f => { f.store.status.recovery.cooldownUntil = new Date(Date.now() + 60000).toISOString(); }],
  ['failed status refresh', f => { f.store.stale = true; }],
  ['stale status timestamp', f => { f.store.statusReceivedAt = Date.now() - 16000; }],
  ['stale scheduler heartbeat', f => { f.store.status.scheduler.schedulerHeartbeatAt = new Date(Date.now() - 31000).toISOString(); }],
  ['invalid scheduler heartbeat', f => { f.store.status.scheduler.schedulerHeartbeatAt = 'invalid'; }],
  ['missing next scan', f => { f.store.status.scheduler.nextRunAt = null; }],
  ['missing scheduler', f => { f.store.status.scheduler = undefined; }],
  ['missing status', f => { f.store.status = null; }],
]) {
  test(`Expedite: ${label} disables a scan without submitting a request`, () => {
    const f = fixture(); change(f);
    assert.ok(f.action.disabledReason); f.action.start(); assert.equal(f.requests, 0);
    assert.equal(f.action.requesting, false); assert.equal(f.refreshes, 0);
  });
}
test('Expedite: leaving the page unsubscribes the pending scan and ignores late responses', () => {
  const f = fixture(); f.action.start();
  assert.equal(f.response.observed, true); f.action.destroy(); assert.equal(f.response.observed, false);
  f.response.next(run()); f.response.complete();
  assert.equal(f.action.run, null); assert.equal(f.action.message, ''); assert.equal(f.refreshes, 0);
});

mocks['./rxo-expedite/expedite-scan-action'] = scanModule;
mocks['./rxo-expedite/expedite-failure-display'] = load(`${feature}/rxo-expedite-control-center/src/lib/rxo-expedite/expedite-failure-display.ts`);
const { RxoExpediteControlCenterComponent } = load(`${feature}/rxo-expedite-control-center/src/lib/rxo-expedite-control-center.component.ts`);
test('Expedite: the page lifecycle cancels its pending manual scan', () => {
  const f = fixture(), c = new RxoExpediteControlCenterComponent(f.store, f.auth, f.api, {});
  c.scan.start(); assert.equal(f.response.observed, true); c.ngOnDestroy();
  assert.equal(f.response.observed, false);
  f.response.next(run()); assert.equal(c.scan.message, ''); assert.equal(f.refreshes, 0);
});
const storeExports = load(`${feature}/rxo-expedite-control-center/src/lib/rxo-expedite/rxo-expedite.store.ts`, { './expedite-scan-action': scanModule });
test('Expedite: status validation rejects malformed manual runs before the UI consumes them', () => {
  assert.equal(storeExports.isExpediteStatus(readyStatus()), true);
  assert.equal(storeExports.isExpediteStatus({ ...readyStatus(), manualRun: run('RUNNING') }), true);
  assert.equal(storeExports.isExpediteStatus({ ...readyStatus(), manualRun: run('EXPORTING') }), false);
  assert.equal(storeExports.isExpediteStatus({ ...readyStatus(), manualRun: { status: 'COMPLETE' } }), false);
});
test('Expedite: the API posts to the dedicated administrator endpoint and actually times out', () => {
  const scheduler = new TestScheduler(() => {}); scheduler.maxFrames = 45001;
  const timeouts = [];
  const { TruckLogApi } = load('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts', {
    rxjs: { ...rxjs, timeout: delay => { timeouts.push(delay); return rxjs.timeout({ first: delay, scheduler }); } },
  });
  const posts = [];
  const api = new TruckLogApi({ post(url, body) { posts.push({ url, body }); return rxjs.NEVER; } });
  let failure;
  api.runRxoExpediteScanNow().subscribe({ error: error => { failure = error; } });
  assert.equal(posts[0].url, '/api/v1/rxo/expedite/rescan');
  assert.equal(Object.keys(posts[0].body).length, 0); assert.equal(timeouts[0], 45000);
  scheduler.flush(); assert.equal(failure?.name, 'TimeoutError');
});

mocks['./rxo-control-center.presenter'] = load(`${feature}/rxo-control-center/src/lib/rxo-control-center.presenter.ts`);
const { RxoControlCenterComponent } = load(`${feature}/rxo-control-center/src/lib/rxo-control-center.component.ts`);
function standardFixture() {
  let requests = 0, refreshes = 0, admin = true;
  const response = new rxjs.Subject(), errors = [], successes = [];
  const c = new RxoControlCenterComponent({ runRxoScanNow() { requests++; return response; } },
    { error: text => errors.push(text), success: text => successes.push(text) }, { canWrite: () => admin }, {});
  c.control = { exporterRunning: true, manualRun: { status: 'IDLE' }, scheduler: { status: 'WAITING' } };
  c.refreshControl = () => { refreshes++; };
  return { c, response, errors, successes, setAdmin(value) { admin = value; }, get requests() { return requests; }, get refreshes() { return refreshes; } };
}
test('Standard RXO: operators, duplicate clicks, active scans, and stopped workers do not submit scans', () => {
  const unprivileged = standardFixture(); unprivileged.setAdmin(false); unprivileged.c.runScanNow(); assert.equal(unprivileged.requests, 0);
  const pending = standardFixture(); pending.c.runScanNow(); pending.c.runScanNow(); assert.equal(pending.requests, 1);
  const running = standardFixture(); running.c.view.scanRunning = true; running.c.runScanNow(); assert.equal(running.requests, 0);
  const stopped = standardFixture(); stopped.c.control.exporterRunning = false; stopped.c.runScanNow(); assert.equal(stopped.requests, 0);
});
test('Standard RXO: a valid queued response immediately updates the tracked manual run', () => {
  const f = standardFixture(), queued = run();
  f.c.runScanNow(); f.response.next(queued); f.response.complete();
  assert.equal(f.c.control.manualRun, queued); assert.equal(f.c.view.scanRunning, true);
  assert.equal(f.c.busy, false); assert.equal(f.refreshes, 1); assert.match(f.successes[0], /queued/);
});
test('Standard RXO: unrelated or malformed responses cannot produce successful scan feedback', () => {
  for (const response of [{ status: 'OK' }, { status: 'QUEUED' }, run('COMPLETE')]) {
    const f = standardFixture(); f.c.runScanNow(); f.response.next(response); f.response.complete();
    assert.equal(f.successes.length, 0); assert.match(f.errors[0], /not confirmed/);
    assert.equal(f.c.control.manualRun.status, 'IDLE'); assert.equal(f.refreshes, 1);
  }
});
test('Standard RXO: leaving the page cancels a pending scan and prevents new requests', () => {
  const f = standardFixture(); f.c.runScanNow(); assert.equal(f.response.observed, true);
  f.c.ngOnDestroy(); assert.equal(f.response.observed, false);
  f.response.next(run()); f.response.complete(); f.c.runScanNow();
  assert.equal(f.successes.length, 0); assert.equal(f.errors.length, 0);
  assert.equal(f.refreshes, 0); assert.equal(f.requests, 1);
  assert.equal(f.c.control.manualRun.status, 'IDLE');
});
console.log(`[PASS] RXO manual scan UI: ${passed} behavioral regressions.`);
