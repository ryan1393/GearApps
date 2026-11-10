// A genuinely empty Freight on the Move list. Scheduled runs publish it only after it has been
// seen twice, at least ten minutes apart; RXO's "0 of 0" while loading is never accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { acquireOnce, verifyLatest, acquisitionStatus, EMPTY_LIST_STABLE_MS, EMPTY_CONFIRM_MIN_MS, EMPTY_CONFIRM_MAX_MS } from '../../../apps/rxo-expedite/src/lib/acquisition.mjs';
import { ExpediteError } from '../../../apps/rxo-expedite/src/lib/workbook.mjs';
import { RxoAuthError } from '../../../apps/rxo-expedite/src/lib/rxo-auth.mjs';
import { LIST_CONTROL_TIMEOUT_MS } from '../../../apps/rxo-expedite/src/lib/list-view.mjs';
import { saveCredentials } from '../../../apps/rxo-expedite/src/lib/credentials.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = fs.readFileSync(path.join(here, 'fixtures', 'Freight On The Move.xlsx'));
const empty = fs.readFileSync(path.join(here, 'fixtures', 'Freight On The Move - empty.xlsx'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-expedite-empty-'));
let count = 0;
const check = (ok, message) => { assert.ok(ok, message); count++; };

// ---- Publication rule (acquireOnce) ----
const browser = { launchPersistentContext: async () => ({ close: async () => {} }) };
const flow = (bytes) => async (context, credentials, save) => save({ saveAs: async (file) => fs.writeFileSync(file, bytes) });
let sequence = 0;
function sandbox() {
  const root = path.join(tmp, String(++sequence)), secretRoot = path.join(root, 'secret'), dataRoot = path.join(root, 'data'), profileRoot = path.join(root, 'state', 'profile');
  for (const dir of [secretRoot, dataRoot, profileRoot]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  saveCredentials({ username: 'expedite-test', password: 'fake' }, secretRoot);
  return { secretRoot, dataRoot, profileRoot };
}
const quiet = async (action) => { const saved = console.error; console.error = () => {}; try { return await action(); } finally { console.error = saved; } };
const scheduled = (s, bytes) => quiet(() => acquireOnce({ ...s, chromium: browser, browserFlow: flow(bytes), protectZeroRegression: true }));
const markerFile = (s) => path.join(s.dataRoot, 'expedite-empty-list.json');
const marker = (s) => (fs.existsSync(markerFile(s)) ? JSON.parse(fs.readFileSync(markerFile(s), 'utf8')) : null);
const backdate = (s, ms) => { const value = marker(s); value.firstObservedAt = new Date(Date.now() - ms).toISOString(); fs.writeFileSync(markerFile(s), JSON.stringify(value)); };
const awaiting = (e) => e instanceof ExpediteError && e.code === 'EMPTY_LIST_AWAITING_SECOND_SCAN';

{
  const s = sandbox();
  const first = await scheduled(s, sample);
  check(first.rowCount === 11 && marker(s) === null, 'a normal scan publishes shipments and records no empty sighting');

  await assert.rejects(scheduled(s, empty), awaiting); count++;
  check(verifyLatest(s.dataRoot).sourceBatchId === first.sourceBatchId, 'the first empty scan keeps the previous batch published');
  check(marker(s)?.state === 'OBSERVED', 'the first empty scan is recorded as a sighting');
  const status = acquisitionStatus(s.dataRoot);
  check(status.state === 'FAILED' && status.lastError === 'EMPTY_LIST_AWAITING_SECOND_SCAN' && status.lastSuccess.rowCount === 11, 'status names the pending confirmation and still reports the previous batch');

  const seenAt = marker(s).firstObservedAt;
  await assert.rejects(scheduled(s, empty), awaiting); count++;
  check(marker(s).firstObservedAt === seenAt && verifyLatest(s.dataRoot).rowCount === 11, 'an immediate repeat does not count as the second scan');

  backdate(s, EMPTY_CONFIRM_MIN_MS + 1000);
  const confirmed = await scheduled(s, empty);
  check(confirmed.rowCount === 0 && verifyLatest(s.dataRoot).sourceBatchId === confirmed.sourceBatchId, 'a second empty scan ten minutes later publishes the empty list');
  check(marker(s)?.state === 'CONFIRMED' && marker(s).sourceBatchId === confirmed.sourceBatchId, 'the published empty batch is recorded as confirmed');

  const again = await scheduled(s, empty);
  check(again.rowCount === 0 && verifyLatest(s.dataRoot).sourceBatchId === again.sourceBatchId && marker(s).sourceBatchId === again.sourceBatchId, 'later empty scans stay published and the older shipments are not restored');

  const back = await scheduled(s, sample);
  check(back.rowCount === 11 && marker(s) === null, 'shipments returning clears the confirmation');
  await assert.rejects(scheduled(s, empty), awaiting); count++;
  check(verifyLatest(s.dataRoot).sourceBatchId === back.sourceBatchId, 'the next empty list must be confirmed again');
}
{
  const s = sandbox();
  await scheduled(s, sample);
  await assert.rejects(scheduled(s, empty), awaiting); count++;
  await scheduled(s, sample);
  check(marker(s) === null, 'a non-empty scan between the two sightings cancels the first');
  await assert.rejects(scheduled(s, empty), awaiting); count++;
  backdate(s, EMPTY_CONFIRM_MAX_MS + 60000);
  await assert.rejects(scheduled(s, empty), awaiting); count++;
  check(Date.now() - Date.parse(marker(s).firstObservedAt) < 60000 && verifyLatest(s.dataRoot).rowCount === 11, 'a sighting older than six hours starts over');
}
{
  const s = sandbox();
  await scheduled(s, sample);
  fs.writeFileSync(markerFile(s), '{"contractVersion":1,"source":"RXO_EXPEDITE","state":"CONFIRMED","sourceBatchId":"20260101T000000000Z-00000000-0000-4000-8000-000000000000"}');
  await assert.rejects(scheduled(s, empty), awaiting); count++;
  check(verifyLatest(s.dataRoot).rowCount === 11, 'a confirmation for a different batch does not unlock an empty publication');
  fs.writeFileSync(markerFile(s), 'not json');
  await assert.rejects(scheduled(s, empty), awaiting); count++;
  check(marker(s)?.state === 'OBSERVED', 'an unreadable marker is treated as no sighting');
}
{
  const s = sandbox();
  const only = await scheduled(s, empty);
  check(only.rowCount === 0 && marker(s) === null, 'with no earlier shipments an empty list publishes at once, as before');
  const manual = sandbox();
  await scheduled(manual, sample);
  const result = await quiet(() => acquireOnce({ ...manual, chromium: browser, browserFlow: flow(empty) }));
  check(result.rowCount === 0 && marker(manual) === null, 'the manual one-off run is unchanged');
}

// ---- Readiness rule (the real downloadNative loop against a fake page and clock) ----
const production = fs.readFileSync(path.join(here, '../../../apps/rxo-expedite/src/lib/acquisition.mjs'), 'utf8');
const start = production.indexOf('export async function downloadNative('), end = production.indexOf('export function fullStatus(', start);
const source = production.slice(start, end).replace('export async function', 'async function');
async function readiness({ summary, preferNonEmpty, coveredUntil = 0 }) {
  let now = 0, exportClickedAt = null, coverChecks = 0;
  const locator = (target = '') => ({
    filter: ({ hasText }) => locator(hasText.source.includes('list') ? 'list' : 'export'),
    or() { return this; }, first() { return this; }, waitFor: async () => {}, count: async () => (target === 'list' ? 1 : 1),
    click: async () => { if (target === 'export') exportClickedAt = now; },
  });
  const page = { url: () => 'https://www.expedite.rxo.com/WebClient/#/freight-on-the-move', frames: () => [], setDefaultTimeout() {}, locator,
    evaluate: async () => summary, waitForTimeout: async (ms) => { now += ms; },
    waitForEvent: async () => ({ suggestedFilename: () => 'fixture.xlsx', failure: async () => null }) };
  const context = { console: { log() {} }, Date: { now: () => now }, ExpediteError, RxoAuthError, EMPTY_LIST_STABLE_MS,
    authenticateExpedite: async () => ({ passwordSubmissions: 0 }), assertFreightSession: async () => {},
    excelControls: () => locator('export'), openFreightList: async () => {},
    freightViewCovered: async () => { coverChecks++; return now < coveredUntil; },
    must: (condition, code) => { if (!condition) throw new ExpediteError(code); },
    context: { pages: () => [page] }, save: async () => {}, options: { auth: {}, onStage() {}, preferNonEmpty } };
  let error = null;
  try { await vm.runInNewContext(source + ';downloadNative(context,{},save,options)', context); } catch (e) { error = e; }
  return { error, exportClickedAt, coverChecks };
}
{
  const uncovered = await readiness({ summary: '0 of 0 Shipments', preferNonEmpty: true });
  check(uncovered.error === null && uncovered.exportClickedAt >= EMPTY_LIST_STABLE_MS, 'an uncovered empty list is exported only after staying at zero for the steady period');
  const slow = await readiness({ summary: '0 of 0 Shipments', preferNonEmpty: true, coveredUntil: 40000 });
  check(slow.error === null && slow.exportClickedAt >= 40000 + EMPTY_LIST_STABLE_MS, 'the steady period starts only once the loading overlay is gone');
  const stuck = await readiness({ summary: '0 of 0 Shipments', preferNonEmpty: true, coveredUntil: Infinity });
  check(stuck.error?.code === 'FREIGHT_LIST_DATA_REVIEW' && stuck.exportClickedAt === null, 'a list that never finishes loading is never exported as empty');
  const normal = await readiness({ summary: '11 of 11 Shipments', preferNonEmpty: true });
  check(normal.error === null && normal.exportClickedAt < 10000 && normal.coverChecks === 0, 'a list with shipments is exported as quickly as before');
  const partial = await readiness({ summary: '5 of 11 Shipments', preferNonEmpty: true });
  check(partial.error?.code === 'FREIGHT_LIST_DATA_REVIEW', 'a partially shown list is still refused');
  const manual = await readiness({ summary: '0 of 0 Shipments', preferNonEmpty: false });
  check(manual.error === null && manual.exportClickedAt < 10000 && manual.coverChecks === 0, 'runs without a non-empty baseline keep the short steady period');
}
check(LIST_CONTROL_TIMEOUT_MS === 90000 && /openFreightList\(page, \{ timeoutMs = LIST_CONTROL_TIMEOUT_MS \}/.test(fs.readFileSync(path.join(here, '../../../apps/rxo-expedite/src/lib/list-view.mjs'), 'utf8')), 'the List step waits 90 seconds for RXO\'s loading overlay');
check(!production.includes("'ZERO_ROW_REGRESSION_REVIEW'"), 'scheduled runs no longer reject every empty list outright');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`[PASS] Expedite empty list: ${count} checks.`);
