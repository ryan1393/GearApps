import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { APPROVED_BODY_RULES, planBladeRequirements, rowBladeSets, setsForRule, uniqueRuleForSets } from './blade-requirement-plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const row = (Summary, Part_Type_Code, Blades_Required, Blade_Quantity_Unit = 'MATCHED_SETS', Summary_Rev = '') =>
  ({ Summary, Summary_Rev, Part_Type_Code, Blades_Required, Blade_Quantity_Unit });

test('approved rules match the TypeScript authority exactly', () => {
  const source = fs.readFileSync(path.join(root, 'libs/manufacturing/shared/util-constants/src/lib/cutter-body-compatibility.constants.ts'), 'utf8');
  const fromTs = [...source.matchAll(/rule\('([^']+)', '\d{3}', '[A-Z]+', '[^']+', (\d+)\)/g)].map((m) => ({ code: m[1], total_blades: Number(m[2]) }));
  assert.deepEqual(fromTs, APPROVED_BODY_RULES.map((r) => ({ ...r })));
});

test('stores both source formats as matched sets without doubling', () => {
  const plan = planBladeRequirements([
    row('A', 'RING', 19), row('A', 'PINION', 19),
    row('B', 'RING', 38, 'TOTAL_BLADES'), row('B', 'PINION', 38, 'TOTAL_BLADES'),
    row('C', 'RING', 22, 'TOTAL_BLADES'), row('D', 'RING', 26, 'TOTAL_BLADES'), row('E', 'RING', 34, 'TOTAL_BLADES'),
  ]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.planned.map((g) => [g.summary, g.sets]), [['A', 19], ['B', 19], ['C', 11], ['D', 13], ['E', 17]]);
});

test('never infers the unit from the number', () => {
  assert.match(rowBladeSets({ Blades_Required: 19 }).error, /never inferred/);
  assert.match(rowBladeSets({ Blades_Required: 38, Blade_Quantity_Unit: 'MATCHED_SETS' }).error, /not an approved/);
  assert.match(rowBladeSets({ Blades_Required: 19, Blade_Quantity_Unit: 'TOTAL_BLADES' }).error, /not an approved/);
});

test('blank and zero rows are reported and never overwrite (32209 stays 17 sets / 34 blades)', () => {
  const plan = planBladeRequirements([
    row('32209', 'RING', 0, 'TOTAL_BLADES'), row('32209', 'PINION', null, 'TOTAL_BLADES'),
    row('32414', 'RING', ''), row('32414', 'PINION', 0),
  ]);
  assert.deepEqual(plan.planned, []);
  assert.equal(plan.skipped.length, 4);
  assert.deepEqual(plan.errors, []);
});

test('RING and PINION must share the Summary quantity; disagreement is left for review', () => {
  const plan = planBladeRequirements([row('X', 'RING', 19), row('X', 'PINION', 13), row('Y', 'RING', 13), row('Y', 'PINION', 26, 'TOTAL_BLADES')]);
  assert.deepEqual(plan.planned.map((g) => [g.summary, g.sets, g.rows.map((r) => r.partTypeCode)]), [['Y', 13, ['RING', 'PINION']]]);
  assert.match(plan.skipped[0].reason, /disagree/);
});

test('planning is idempotent', () => {
  const rows = [row('A', 'RING', 38, 'TOTAL_BLADES'), row('A', 'PINION', 19)];
  assert.deepEqual(planBladeRequirements(rows), planBladeRequirements(rows));
  assert.equal(planBladeRequirements(rows).planned[0].sets, 19);
});

test('26 blades never identifies a body rule by itself', () => {
  assert.equal(uniqueRuleForSets(13), null);
  assert.equal(uniqueRuleForSets(17), '088');
  assert.equal(setsForRule('105-SPECIAL'), 13);
  assert.equal(setsForRule('076'), 13);
});

test('packaged base data declares its unit and keeps the established quantities', () => {
  const data = JSON.parse(fs.readFileSync(path.join(here, 'data/cutter_blade_requirements.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.ok(data.every((r) => r.Blade_Quantity_Unit === 'MATCHED_SETS'));
  const plan = planBladeRequirements(data);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.skipped, []);
  const sets = (s) => plan.planned.find((g) => g.summary === s)?.sets;
  assert.equal(sets('32209'), 17); // 088 Standard, 34 blades
  assert.equal(sets('30538'), 19); // 105, 38 blades
  for (const s of ['30131', '30132', '30133', '30136']) assert.equal(sets(s), 13); // 26 blades: 076 or 105 Special
});

test('JS Dana S/N decoder agrees with the TypeScript authority', async (t) => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 23) { t.skip('needs Node type stripping (project Node is 24)'); return; }
  const { decodeDanaSerial } = await import('./blade-requirement-plan.mjs');
  const ts = await import(path.join(root, 'libs/manufacturing/shared/util-constants/src/lib/cutter-body-compatibility.constants.ts'));
  const samples = ['CGRT064AAA', 'CGLT076AAA', 'CGRT088AAA', 'CGRT105AAA', 'CGRT1058AA', 'CGRT105A8A', 'CGRT0768AA', ' cgrt1058aa ',
    '', null, 'CGRT105', 'CGRT-105-8A', 'CGRT099AAA', '1GRT105AAA', 'CGRT105-8A'];
  for (const s of samples) {
    const a = decodeDanaSerial(s); const b = ts.decodeDanaCutterSerial(s);
    assert.equal(a.valid, b.valid, String(s));
    if (a.valid) assert.equal(a.rule, b.rule.code, String(s));
  }
});
