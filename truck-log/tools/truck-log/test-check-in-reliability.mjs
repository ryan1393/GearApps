import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const rxjs = require('rxjs');
const { TestScheduler } = require('rxjs/testing');
const root = process.cwd();
const timers = new Map();
let timerId = 0;
let now = Date.now();
let gate = 'EAST';
const prompts = [];
const browser = {
  localStorage: { getItem: () => gate },
  sessionStorage: { setItem() {}, getItem() { return null; } },
  setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
  prompt: () => prompts.shift() ?? null,
};
const decorator = () => value => value;
const mocks = {
  '@angular/core': { Component: decorator, Injectable: decorator },
  '@angular/common': {}, '@angular/forms': {}, '@truck-log/web/data-access': {},
  '@truck-log/shared/contracts': {}, '@truck-log/web/ui': {}, '@dana/ui': {},
  './dock-status-widget.component': {}, './driver-print-tracker.service': {}, './freight-load-picker.service': {},
  './combobox-exact-enter.directive': {},
  rxjs,
};
function load(relative) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  const record = { exports: {} };
  vm.runInNewContext(result.outputText, {
    module: record, exports: record.exports,
    require(name) { assert(name in mocks, `Unexpected runtime dependency: ${name}`); return mocks[name]; },
    window: browser,
    Date: class extends Date { static now() { return now; } },
  }, { filename: relative });
  return record.exports;
}
const checkInRoot = 'libs/truck-log/web/feature/check-in/src/lib/';
mocks['@truck-log/web/domain'] = load('libs/truck-log/web/domain/src/lib/check-in-form.ts');
const { CheckInComponent } = load(checkInRoot + 'check-in.component.ts');
const { DriverPrintTracker } = load(checkInRoot + 'driver-print-tracker.service.ts');
let passed = 0;
function test(name, fn) { timers.clear(); prompts.length = 0; gate = 'EAST'; fn(); passed++; console.log(`[PASS] ${name}`); }
const toast = { error() {}, warning() {}, success() {} };
const empty = () => mocks['@truck-log/web/domain'].emptyCheckInForm();
const filled = () => ({ ...empty(), loadNumber: 'LOAD1', direction: 'INBOUND', originName: 'Origin', destinationName: 'Fort Wayne', driverName: 'Driver', driverPhone: '2605551212', carrierName: 'Carrier', tractorId: 'T1', trailerId: 'R1', dockCode: 'D1' });
const printPackage = () => ({ packageId: 'package-a', automaticDockAssignment: true, status: 'QUEUED', items: [{ id: 'item-a', itemType: 'DOCK_ASSIGNMENT', status: 'QUEUED', recoverable: true }] });
const visit = (id = 1, driverPrintPackage = printPackage()) => ({ id, loadNumber: 'LOAD1', driverName: 'Driver', dockCode: 'D1', direction: 'INBOUND', driverPrintPackage });
function fixture({ auto = true, configFails = false } = {}) {
  const creates = [], uploads = [], tracked = [];
  let key = 0;
  const api = {
    newIdempotencyKey: () => `action-key-${++key}`,
    createVisit(request) { const subject = new rxjs.Subject(); creates.push({ request, subject }); return subject; },
    uploadDocument(visitId, file) { const subject = new rxjs.Subject(); uploads.push({ visitId, file, subject }); return subject; },
    checkInReferenceData: () => rxjs.of({ drivers: [], carriers: [], locations: [] }),
    checkInConfig: () => configFails ? rxjs.throwError(() => new Error('offline')) : rxjs.of({ automaticDriverPrinting: auto, plantLocationName: 'Fort Wayne' }),
    docks: () => rxjs.of([{ code: 'D1', active: true }]),
  };
  const loads = { loadFreightLoads() {}, removeWhere() {} };
  const tracker = new DriverPrintTracker(api, toast);
  const originalTrack = tracker.startTracking.bind(tracker);
  tracker.startTracking = (...args) => { tracked.push(args); originalTrack(...args); };
  const component = new CheckInComponent(api, toast, loads, tracker);
  component.ngOnInit();
  component.form = filled();
  return { component, tracker, api, creates, uploads, tracked };
}

test('Automatic mode defaults only when server setup and workstation gate are ready', () => {
  const ready = fixture(); assert.equal(ready.component.printMode, 'AUTOMATIC');
  ready.component.save();
  assert.equal(ready.creates[0].request.autoPrintDockSlip, true);
  assert.equal(ready.creates[0].request.guardGate, 'EAST');
  gate = '';
  const noGate = fixture(); assert.equal(noGate.component.printMode, 'MANUAL');
  noGate.component.choosePrintMode('AUTOMATIC'); assert.equal(noGate.component.printMode, 'MANUAL');
});

test('Manual check-in preserves RXO identity and needs no print agent or stored gate', () => {
  gate = '';
  const f = fixture({ auto: false });
  f.component.selectedFreight = { site_key: 'fort-wayne', shipment_id: 'LOAD1', direction: 'INBOUND' };
  f.component.save();
  const request = f.creates[0].request;
  assert.equal(request.autoPrintDockSlip, false);
  assert.equal('guardGate' in request, false);
  assert.equal(request.rxoShipmentId, 'LOAD1');
  f.creates[0].subject.next(visit(1, null));
  assert.equal(f.component.lastCheckInManualPrinting, true);
  assert.equal(f.tracked[0][3], false, 'Manual check-in must not discover or queue print packages');
  assert.equal(f.tracker.lastVisitId, 1);
});

test('Unavailable print configuration still permits explicit manual check-in', () => {
  const f = fixture({ configFails: true });
  assert.equal(f.component.printingConfigLoading, false);
  assert.equal(f.component.printMode, 'MANUAL');
  f.component.save(); assert.equal(f.creates[0].request.autoPrintDockSlip, false);
});

test('Submitting the next truck preserves the previous accepted print job on failure', () => {
  const f = fixture();
  f.tracker.startTracking(visit(10), 'previous-key', null, false);
  const timer = f.tracker.packagePollTimer;
  f.component.save();
  assert.equal(f.tracker.lastPrintPackage.packageId, 'package-a');
  assert.equal(f.tracker.packagePollTimer, timer);
  f.creates[0].subject.error({ status: 409 });
  assert.equal(f.tracker.lastVisitId, 10);
  assert.equal(f.tracker.lastPrintPackage.packageId, 'package-a');
  assert.equal(f.tracker.packagePollTimer, timer);
});

test('Pending form events are blocked and accepted print tracking uses the submitted immutable key', () => {
  const f = fixture(); f.component.save();
  const sentKey = f.creates[0].request.clientRequestId;
  f.component.loadNumberChanged(); f.component.useManualLoadEntry(); f.component.setDirection('OUTBOUND');
  assert.equal(f.component.form.direction, 'INBOUND');
  assert.equal(f.component.pendingCheckInRequestId, sentKey);
  // Also defend against any later draft reset outside these event handlers.
  f.component.pendingCheckInRequestId = '';
  f.creates[0].subject.next(visit());
  assert.equal(f.tracked.at(-1)[1], sentKey);
});

test('Pending paperwork cannot gain or lose files after the upload queue snapshot', () => {
  const f = fixture();
  const first = { name: 'first.pdf', size: 1, lastModified: 1 };
  f.component.files = [first];
  f.component.save(); f.creates[0].subject.next(visit());
  assert.equal(f.uploads.length, 1);
  f.component.filesSelected({ target: { files: [{ name: 'second.pdf', size: 2, lastModified: 2 }], value: 'second.pdf' } });
  f.component.removeFile(0);
  assert.equal(f.component.files.length, 1);
  assert.equal(f.component.files[0].name, 'first.pdf');
  f.uploads[0].subject.next({});
  assert.equal(f.component.saving, false);
  assert.equal(f.component.files.length, 0);
});

test('Failed paperwork retains only unacknowledged files and retry uploads to the accepted visit', () => {
  const f = fixture();
  f.component.files = [{ name: 'first.pdf', size: 1, lastModified: 1 }, { name: 'second.pdf', size: 2, lastModified: 2 }];
  f.component.save(); f.creates[0].subject.next(visit(42));
  f.uploads[0].subject.next({}); f.uploads[1].subject.error({ status: 503 });
  assert.equal(f.component.retryFiles.length, 1);
  assert.equal(f.component.retryFiles[0].name, 'second.pdf');
  // A failed upload never blocks the gate: the form is released for the next truck.
  assert.equal(f.component.formDisabled, false);
  assert.equal(f.component.retryVisit.id, 42);
  // The next truck is checked in before the retry: the retry still goes to visit 42.
  f.component.form = filled(); f.component.save(); f.creates[1].subject.next(visit(43));
  f.component.retryPaperwork(); assert.equal(f.uploads[2].visitId, 42);
  assert.equal(f.component.formDisabled, false, 'A retry never locks the form');
  f.uploads[2].subject.next({});
  assert.equal(f.component.retryFiles.length, 0);
  assert.equal(f.component.retryVisit, null);
});

test('Hung print status times out, releases manual refresh, and reports Truck Log unreachable', () => {
  const scheduler = new TestScheduler((actual, expected) => assert.deepEqual(actual, expected));
  let calls = 0;
  const tracker = new DriverPrintTracker({ driverPrintPackageById: () => { calls++; return rxjs.NEVER; } }, toast);
  tracker.startTracking(visit(), 'key', null, false);
  scheduler.run(() => {
    tracker.refreshDriverPrintPackage(1, true);
    assert.equal(tracker.printPackageLoading, true);
    scheduler.schedule(() => {
      assert.equal(tracker.printPackageLoading, false);
      assert.equal(tracker.printerNotResponding, false);
      tracker.refreshDriverPrintPackage(1, false);
      assert.equal(calls, 2, 'Manual refresh should work again after timeout');
    }, 15001);
    scheduler.schedule(() => {
      assert.equal(tracker.printPackageLoading, false);
      now += 180001;
      tracker.refreshDriverPrintPackage(1, true);
    }, 30002);
    scheduler.schedule(() => {
      assert.equal(tracker.printPackageLoading, false);
      // Every status read timed out: Truck Log was unreachable, so the printer is not blamed.
      assert.equal(tracker.printerNotResponding, false);
      assert.equal(tracker.printStatusUnreachable, true);
    }, 45003);
  });
});

test('Readable but unchanged print status for 3 minutes blames the printer, not the connection', () => {
  const tracker = new DriverPrintTracker({ driverPrintPackageById: () => rxjs.of(printPackage()), driverPrintPackage: () => rxjs.of(printPackage()) }, toast);
  tracker.startTracking(visit(), 'key', null, false);
  now += 180001;
  tracker.refreshDriverPrintPackage(1, true);
  assert.equal(tracker.printerNotResponding, true);
  assert.equal(tracker.printStatusUnreachable, false);
});

test('Queued replacement reuses an ambiguous action key and tracks only confirmed replacement', () => {
  const f = fixture();
  f.tracker.startTracking(visit(9), 'guard-key', null, false);
  const recoveries = [];
  f.api.recoverQueuedPrint = (...args) => { const subject = new rxjs.Subject(); recoveries.push({ args, subject }); return subject; };
  f.api.driverPrintPackageById = () => rxjs.of(f.tracker.lastPrintPackage);
  prompts.push('Wrong gate', 'WEST');
  const item = f.tracker.lastPrintPackage.items[0];
  f.tracker.recoverQueuedItem(item, 'REPLACE');
  assert.equal(recoveries[0].args[1].gate, 'WEST');
  assert.equal(recoveries[0].args[3], 'guard-key');
  recoveries[0].subject.error({ status: 0 });
  prompts.push('Wrong gate', 'WEST');
  f.tracker.recoverQueuedItem(item, 'REPLACE');
  assert.equal(recoveries[1].args[2], recoveries[0].args[2]);
  const replacement = { ...printPackage(), packageId: 'replacement-package' };
  recoveries[1].subject.next(replacement);
  assert.equal(f.tracker.lastPrintPackage.packageId, 'replacement-package');
});

test('A late status response cannot overwrite an acknowledged replacement package', () => {
  const f = fixture();
  const oldStatus = new rxjs.Subject(), recovery = new rxjs.Subject();
  f.api.driverPrintPackageById = () => oldStatus;
  f.api.recoverQueuedPrint = () => recovery;
  f.tracker.startTracking(visit(9), 'guard-key', null, false);
  f.tracker.refreshDriverPrintPackage(9, true);
  prompts.push('Wrong printer', 'WEST');
  f.tracker.recoverQueuedItem(f.tracker.lastPrintPackage.items[0], 'REPLACE');
  recovery.next({ ...printPackage(), packageId: 'replacement-package' });
  assert.equal(f.tracker.printPackageLoading, false);
  oldStatus.next(printPackage()); oldStatus.complete();
  assert.equal(f.tracker.lastPrintPackage.packageId, 'replacement-package');
});

test('Replacement status is fetched by exact package identity, not the visit original', () => {
  const f = fixture();
  f.tracker.startTracking(visit(9, { ...printPackage(), packageId: 'replacement-package' }), 'guard-key', null, false);
  let requested = '';
  f.api.driverPrintPackage = () => { throw new Error('Replacement polling requested original visit package'); };
  f.api.driverPrintPackageById = id => { requested = id; return rxjs.of({ ...printPackage(), packageId: id }); };
  f.tracker.refreshDriverPrintPackage(9, true);
  assert.equal(requested, 'replacement-package');
});

test('A replacement can be rediscovered after an ambiguous recovery response', () => {
  const f = fixture();
  const original = printPackage();
  original.items[0] = { ...original.items[0], status: 'FAILED', recoverable: false, cancelled: true, replacementPackageId: 'replacement-ack-lost' };
  f.tracker.startTracking(visit(9, original), 'guard-key', null, false);
  f.api.driverPrintPackageById = id => rxjs.of({ ...printPackage(), packageId: id });
  f.tracker.trackReplacement(original.items[0]);
  assert.equal(f.tracker.lastPrintPackage.packageId, 'replacement-ack-lost');
  assert.equal(f.tracker.recoveringItemId, '');
});

test('Cancelled print items expose no failed-item retry action', () => {
  const f = fixture();
  const cancelled = printPackage();
  cancelled.items[0] = { ...cancelled.items[0], status: 'FAILED', cancelled: true, recoverable: false };
  f.tracker.startTracking(visit(9, cancelled), 'guard-key', null, false);
  f.api.retryDockAssignmentPrint = () => { throw new Error('Cancelled job retried'); };
  f.tracker.retryDockAssignment();
  assert.equal(f.tracker.printItemStatusLabel(cancelled.items[0]), 'Cancelled before printing');
});

const template = fs.readFileSync(path.join(root, checkInRoot + 'check-in.component.html'), 'utf8');
assert.match(template, /<fieldset[^>]*\[disabled\]="formDisabled"/);
assert.match(template, /<input type="file" \[disabled\]="formDisabled"/);
console.log(`[PASS] Check-in reliability: ${passed} behavioral regressions plus form/file disabled bindings.`);
