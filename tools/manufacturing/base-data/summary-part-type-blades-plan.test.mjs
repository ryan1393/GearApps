import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { mergeIntoStored, placeLabels, planSummaryPartTypeBlades } from './summary-part-type-blades-plan.mjs';

const data = JSON.parse(fs.readFileSync(new URL('./data/summary_part_type_blades.json', import.meta.url), 'utf8'));
const plan = planSummaryPartTypeBlades(data.rows);
const find = (summary, partType) => plan.planned.find((p) => p.summary === summary && p.part_type === partType);

test('the packaged source has every Summary + Part Type once', () => {
  assert.equal(data.rows.length, 216);
  assert.equal(new Set(data.rows.map((r) => `${r.Summary}|${r.Part_Type_Code}`)).size, 216);
});

test('confirmed 30538 positions: RING RH/RH IB/RH OB, PINION LH/LH IB/RH IB (RH IB kept as Outer)', () => {
  assert.deepEqual(
    (({ hos, inner_blade, outer_blade }) => ({ hos, inner_blade, outer_blade }))(find('30538', 'RING')),
    { hos: 'RH', inner_blade: 'RH IB', outer_blade: 'RH OB' });
  assert.deepEqual(
    (({ hos, inner_blade, outer_blade }) => ({ hos, inner_blade, outer_blade }))(find('30538', 'PINION')),
    { hos: 'LH', inner_blade: 'LH IB', outer_blade: 'RH IB' });
});

test('30588 and 32414 are out of scope; zero rows (32209) are skipped, never imported as blank values', () => {
  for (const s of ['30588', '32414', '32209']) assert.equal(plan.planned.filter((p) => p.summary === s).length, 0, s);
  assert.match(plan.skipped.find((k) => k.summary === '30588' && k.part_type === 'RING').reason, /no 30588 RING mapping/);
  assert.match(plan.skipped.find((k) => k.summary === '32209').reason, /zero\/blank/);
});

test('HOS is per Part Type from the source column, not derived from the other type or the labels', () => {
  assert.equal(find('1.955FC', 'RING').hos, 'RH');
  assert.equal(find('1.955FC', 'PINION').hos, 'LH');
  assert.ok(plan.planned.every((p) => p.hos === null || ['RH', 'LH'].includes(p.hos)));
});

test('positions: one IB + one OB uses the recorded placement; anything else stays blank', () => {
  assert.deepEqual(placeLabels('1', 'RING', 'RH OB', 'RH IB'), { inner: 'RH IB', outer: 'RH OB', basis: 'recorded V43/V45 placement: the IB label is Inner, the OB label is Outer' });
  assert.equal(placeLabels('99999', 'PINION', 'LH IB', 'RH IB').inner, null);
  assert.equal(placeLabels('1', 'RING', 'RH OB', 'LH OB').outer, null);
  assert.equal(placeLabels('1', 'RING', 'RH IB', null).inner, null);
  // Every planned row either has both positions or neither.
  assert.ok(plan.planned.every((p) => Boolean(p.inner_blade) === Boolean(p.outer_blade)));
});

test('later edits win and a rerun changes nothing', () => {
  const p = find('30538', 'PINION');
  const first = mergeIntoStored(null, p);
  assert.equal(first.changes, true);
  assert.deepEqual(mergeIntoStored(first.next, p), { next: first.next, changes: false, kept: [] });
  const edited = { hos: 'LH', inner_blade: 'LH IB', outer_blade: 'LH OB' };
  const again = mergeIntoStored(edited, p);
  assert.equal(again.changes, false);
  assert.deepEqual(again.next, edited);
  assert.deepEqual(again.kept, ['outer_blade: kept LH OB (source RH IB)']);
  assert.equal(mergeIntoStored({ hos: null, inner_blade: null, outer_blade: 'RH IB' }, p).next.inner_blade, 'LH IB');
});
