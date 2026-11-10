// Dock Board one-scan path: after the Delivery Number is saved, the uploaded PDF is attached
// without preview ONLY when exactly one validated Print Agent capture carries that number,
// it belongs to no visit, and the visit has no packing slip yet. Runs the real service code
// against in-memory repositories.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let count = 0;
const check = (ok, message) => { assert.ok(ok, message); count++; };

class BadRequestException extends Error {}
class ConflictException extends Error {}
class NotFoundException extends Error {}
class TruckVisit {} class VisitDocument {} class VisitEvent {} class SapDocumentEvent {}
const IS_NULL = { isNull: true };
let unreadable = new Set();

const servicePath = 'libs/truck-log/server/feature/visits/src/lib/dock-packing-scan.service.ts';
const code = ts.transpileModule(read(servicePath), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, Buffer, console, Date, JSON, Number, Set, Error, Promise,
  require(name) {
    if (name === '@nestjs/common') return { BadRequestException, ConflictException, NotFoundException, Injectable: () => (x) => x };
    if (name === '@nestjs/config') return { ConfigService: class {} };
    if (name === 'node:crypto') return crypto;
    if (name === 'typeorm') return { DataSource: class {}, EntityManager: class {}, IsNull: () => IS_NULL };
    if (name === '@truck-log/shared/contracts') return { VisitStatuses: { DOCK_ASSIGNED: 'DOCK_ASSIGNED' } };
    if (name === '@truck-log/server/data-access') return { TruckVisit, VisitDocument, VisitEvent, SapDocumentEvent };
    if (name === './workflow-signing-key') return { workflowSigningKey: () => Buffer.alloc(32, 1) };
    if (name === './dock-scan-document-storage') return { readDockScanPdf: async (_root, relativePath) => { if (unreadable.has(relativePath)) throw new Error('missing'); return Buffer.from('%PDF-'); } };
    if (name === './packing-slip-supersession') return { retirePackingSlip: async () => { throw new Error('auto-attach must never replace a slip'); } };
    if (name === './visit-delivery-scans') return { DELIVERY_SCAN_EVENT: 'S', DELIVERY_MANUAL_EVENT: 'M', deliveryScanNote: (n) => n, deliveryManualNote: (n) => n };
    throw new Error('Unexpected import: ' + name);
  } });
const { DockPackingScanService } = module.exports;

const NUMBER = '13246286';
const capture = (id, overrides = {}) => ({ id, truckVisitId: null, documentType: 'PACKING_SLIP', sapDocumentTypeCode: 'PACKING_SLIP',
  extractedDocumentId: NUMBER, reportedDocumentId: NUMBER, extractionStatus: 'DETECTED', mimeType: 'application/pdf',
  storageStatus: 'STORED', validationStatus: 'VALIDATED', validationRuleVersion: 'PACKING_SLIP_V1', reviewStatus: 'NEEDS_REVIEW',
  retentionStatus: 'ACTIVE', supersededAt: null, sha256: 'a'.repeat(64), associationStatus: 'UNMATCHED', sourceKind: 'PRINT_AGENT',
  isAuthoritative: false, associatedAt: null, supersedesDocumentId: null, fileSizeBytes: 100, relativePath: `sap/${id}.pdf`,
  capturedAt: new Date(2026, 10, 10, 12, id), ...overrides });

function world(documents, visitStatus = 'DOCK_ASSIGNED') {
  const state = { visits: [{ id: 7, status: visitStatus }], documents, visitEvents: [], sapEvents: [] };
  const tables = new Map([[TruckVisit, state.visits], [VisitDocument, state.documents], [VisitEvent, state.visitEvents], [SapDocumentEvent, state.sapEvents]]);
  const matches = (row, where) => Object.entries(where).every(([key, value]) => value === IS_NULL ? row[key] == null : row[key] === value);
  const manager = { getRepository: (entity) => {
    const rows = tables.get(entity);
    return {
      find: async ({ where, take }) => rows.filter((row) => [].concat(where).some((w) => matches(row, w))).slice(0, take ?? rows.length),
      findOne: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      create: (value) => ({ ...value }),
      save: async (value) => { if (!rows.includes(value)) rows.push(value); return value; },
    };
  } };
  const service = new DockPackingScanService({ manager, transaction: (work) => work(manager) }, { get: () => undefined });
  return { state, service };
}

// Exactly one validated, unmatched capture: attached without preview, with a full audit trail.
{
  unreadable = new Set();
  const { state, service } = world([capture(2)]);
  const doc = await service.attachSoleMatch(7, NUMBER);
  check(doc && doc.id === 2 && doc.truckVisitId === 7 && doc.associationStatus === 'ASSOCIATED', 'the sole matching PDF is attached to the visit');
  check(doc.associationMethod === 'DOCK_SCAN_AUTO' && doc.isAuthoritative === true && doc.reviewStatus === 'RESOLVED' && doc.fileAvailable === true, 'the attachment is recorded as an automatic sole match');
  check(state.visitEvents.length === 1 && state.visitEvents[0].eventType === 'PACKING_SLIP_AUTO_ATTACHED' && state.visitEvents[0].truckVisitId === 7, 'the visit timeline records the automatic attachment');
  check(state.sapEvents.length === 1 && state.sapEvents[0].details.previewConfirmed === false && state.sapEvents[0].toVisitId === 7, 'the document history states no preview was confirmed');
  check(await service.attachSoleMatch(7, NUMBER) === null && state.visitEvents.length === 1, 'a second scan does not attach or log again');
}

// Every ambiguous or unsafe case attaches nothing and leaves the captures untouched.
const untouched = (state) => state.documents.every((d) => d.truckVisitId === null || d.keep) && state.visitEvents.length === 0 && state.sapEvents.length === 0;
for (const [label, documents, setup] of [
  ['no uploaded capture', []],
  ['two captures with the same number', [capture(2), capture(3)]],
  ['a capture that still needs review', [capture(2, { validationStatus: 'REVIEW_REQUIRED' })]],
  ['a capture reported under a different number', [capture(2, { reportedDocumentId: '99999999' })]],
  ['a capture already on another visit', [capture(2, { truckVisitId: 9, associationStatus: 'ASSOCIATED', keep: true })]],
  ['a visit that already has a packing slip', [capture(2), { id: 5, truckVisitId: 7, documentType: 'PACKING_SLIP', keep: true }]],
  ['a PDF missing from storage', [capture(2)], () => { unreadable = new Set(['sap/2.pdf']); }],
  ['a dismissed capture', [capture(2, { reviewStatus: 'DISMISSED' })]],
]) {
  unreadable = new Set();
  setup?.();
  const { state, service } = world(documents);
  check(await service.attachSoleMatch(7, NUMBER) === null && untouched(state), `${label}: nothing is attached`);
}

// Guards shared with the confirm path.
{
  unreadable = new Set();
  const closed = world([capture(2)], 'DOCK_COMPLETE');
  await assert.rejects(closed.service.attachSoleMatch(7, NUMBER), ConflictException); count++;
  check(untouched(closed.state), 'a visit no longer at the dock is refused');
  for (const bad of ['1324628', '132462860', 'abcdefgh', '', null]) { await assert.rejects(world([capture(2)]).service.attachSoleMatch(7, bad), BadRequestException); count++; }
  await assert.rejects(world([capture(2)]).service.attachSoleMatch(8, NUMBER), NotFoundException); count++;
}

// Wiring: Scan Document calls the endpoint after the save; Find PDF keeps preview-and-confirm.
const controller = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.controller.ts');
const component = read('libs/truck-log/web/feature/dock-board/src/lib/dock-scan/dock-scan.component.ts');
const api = read('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
check(controller.includes("@Post(':id/packing-slip/scan/auto-attach')") && controller.includes('this.dockScan.attachSoleMatch(id, body.deliveryNumber)'), 'the API exposes the sole-match attachment');
check(api.includes('/packing-slip/scan/auto-attach`, { deliveryNumber })'), 'the web client calls the sole-match attachment');
check(component.indexOf('this.saved.emit(receipt);') > 0 && component.indexOf('this.saved.emit(receipt);') < component.indexOf('autoAttachScannedPackingSlip(visitId, deliveryNumber)'), 'the number is saved before any attachment is attempted');
check(/error: \(\) => \{[^}]*finish\(\); \}/.test(component), 'a failed attachment attempt still closes with the number saved');
check(component.includes("this.message = 'Delivery Number saved. Looking for an optional matching PDF…';") && component.includes('this.api.scanPackingSlip(visitId, deliveryNumber)'), 'Find PDF still lists candidates for review');
check(read(servicePath).includes("doc.associationMethod = 'DOCK_SCAN_CONFIRM';") && read(servicePath).includes('previewConfirmed: true'), 'the reviewed confirmation path is unchanged');
check(read('libs/truck-log/web/domain/src/lib/visit-display.ts').includes('PACKING_SLIP_AUTO_ATTACHED:'), 'the timeline has a label for the automatic attachment');

console.log(`[PASS] Dock scan auto-attach: ${count} checks.`);
