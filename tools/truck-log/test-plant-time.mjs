// Plant-time formatting: every screen shows times in the plant zone, whatever the device's zone.
// Runs under TZ=UTC to stand in for a CK65 or TV left on UTC.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
process.env.TZ = 'UTC';

function load(file, mocks) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, Intl, Date, require: (name) => { assert(name in mocks, `Unexpected dependency ${name}`); return mocks[name]; } }, { filename: file });
  return module.exports;
}
const contracts = { PLANT_TIME_ZONE_DEFAULT: 'America/Indiana/Indianapolis' };
const time = load('libs/truck-log/web/domain/src/lib/plant-time.ts', { '@truck-log/shared/contracts': contracts });
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`[PASS] ${name}`); };

test('defaults to the plant zone, not the device zone', () => {
  assert.equal(time.plantTimeZone(), 'America/Indiana/Indianapolis');
  // 03:30 UTC on Nov 13 is 10:30 PM on Nov 12 in Indiana (EST, UTC-5).
  assert.equal(time.formatPlantDate('2026-11-13T03:30:00Z', 'short'), '11/12/26, 10:30 PM');
  assert.equal(time.formatPlantDate('2026-11-13T03:30:00Z', 'shortTime'), '10:30 PM');
});
test('follows daylight saving time (EDT is UTC-4)', () => {
  assert.equal(time.formatPlantDate('2026-07-01T16:05:09Z', 'M/d/yy h:mm:ss a'), '7/1/26 12:05:09 PM');
});
test('supports the DatePipe formats the templates use', () => {
  const v = '2026-03-02T14:07:00Z'; // 9:07 AM EST, Monday
  assert.equal(time.formatPlantDate(v, 'EEE M/d h:mm a'), 'Mon 3/2 9:07 AM');
  assert.equal(time.formatPlantDate(v, 'M/d h:mm a'), '3/2 9:07 AM');
  assert.equal(time.formatPlantDate(v), 'Mar 2, 2026');
  assert.equal(time.formatPlantDate('2026-03-02T05:00:00Z', 'h:mm a'), '12:00 AM');
  assert.equal(time.formatPlantDate('2026-03-02T17:00:00Z', 'h:mm a'), '12:00 PM');
});
test('smartTime shows the date for anything not from today (plant time)', () => {
  const now = Date.parse('2026-11-13T14:00:00Z'); // 9:00 AM Nov 13 in Indiana
  assert.equal(time.formatPlantDate('2026-11-13T13:00:00Z', 'smartTime', now), '8:00 AM');
  // 11:40 PM the evening before — in UTC this is already "today", in the plant it is not.
  assert.equal(time.formatPlantDate('2026-11-13T04:40:00Z', 'smartTime', now), '11/12 11:40 PM');
});
test('invalid or missing values give an empty string', () => {
  assert.equal(time.formatPlantDate(null, 'short'), '');
  assert.equal(time.formatPlantDate('not a date', 'short'), '');
});
test('the server zone replaces the default; invalid zones are ignored', () => {
  assert.equal(time.setPlantTimeZone('Not/AZone'), false);
  assert.equal(time.setPlantTimeZone('America/Chicago'), true);
  assert.equal(time.formatPlantDate('2026-11-13T03:30:00Z', 'shortTime'), '9:30 PM');
  assert.equal(time.setPlantTimeZone('America/Chicago'), false);
});
console.log(`[PASS] Plant time: ${passed} cases.`);
