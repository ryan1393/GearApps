import assert from 'node:assert/strict';
import test from 'node:test';
import { CANONICAL_GEARSET_COLUMNS, compareSeed, seedGearsets, seedRules } from './audit-gearsets.mjs';

// Shape of the October seed record named in the gearset handoff (10006253).
const seed = {
  import_rules: { gearset_part_type: 'GEARSET', status_only_on_gearsets: true, archive_gearset_only: true, archive_linked_parts: false, hard_reset_test_data: true },
  gearsets: [
    { gearset_part_number: '10006253', summary: '31241', models: ['186'], ratio: 3.45, ring_part_number: '10006254', ring_teeth: 38,
      pinion_part_number: '10006255', pinion_teeth: 11, customer: 'Stellantis', application: 'JL Jeep Wrangler Front',
      statuses: ['Production'], cut: '3-Axis', source_requirement: 13, required_blades: 26 },
    { gearset_part_number: '10060460', summary: '30634', ring_part_number: '10060462', pinion_part_number: '10060466', statuses: ['Production'] },
    { gearset_part_number: '10161958', summary: '30634', ring_part_number: '10161959', pinion_part_number: '10060466', statuses: ['Service'] },
    { gearset_part_number: 'X1', summary: '1.955FC', ring_part_number: 'R', pinion_part_number: 'P', source_requirement: 19, required_blades: 76 },
  ],
};
const db = [
  { number: '10006253', summary: '31241', model: '186', ring: '10006254', ring_teeth: 38, pinion: '10006255', pinion_teeth: 11,
    customer: 'Stellantis', application: 'JL Jeep Wrangler Front', statuses: ['Production'], cut: '3-Axis', ring_sets: 13 },
  { number: '10060460', summary: '30634', ring: '10060462', pinion: '10060466', statuses: ['Production'] },
  { number: '10161958', summary: '30634', ring: '10161959', pinion: '10060466', statuses: [] },
  { number: 'DB-ONLY', summary: '1', ring: 'r', pinion: 'p', statuses: [] },
];

test('reads seed gearsets keeping Summary text, arrays and RING/PINION roles', () => {
  const rows = seedGearsets(seed);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].models, ['186']);
  assert.deepEqual(rows[2].statuses, ['Service']);
  assert.equal(rows[3].summary, '1.955FC');
  assert.equal(rows[1].pinion, rows[2].pinion);
  assert.throws(() => seedGearsets({ other: [] }), /No gearsets array/);
});

test('reports import rules without acting on them', () => {
  assert.deepEqual(seedRules(seed), { gearset_part_type: 'GEARSET', status_only_on_gearsets: true, archive_gearset_only: true, archive_linked_parts: false, hard_reset_test_data: true });
});

test('compares by gearset number: shared pinion kept, business status difference reported, no doubling', () => {
  const result = compareSeed(seedGearsets(seed), db);
  assert.deepEqual(result.missing_in_database, ['X1']);
  assert.deepEqual(result.database_only, ['DB-ONLY']);
  assert.deepEqual(result.differences, [{ gearset: '10161958', diffs: ['business statuses: seed Service / database —'] }]);
  // 13 source sets = 26 blades matches stored 13 sets; 19 -> 76 is a doubled-twice value.
  assert.deepEqual(result.doubled_requirement_problems, ['X1: required_blades 76 is not source_requirement 19 x 2']);
});

test('canonical column list matches the repository DDL', async () => {
  const fs = await import('node:fs');
  const ddl = fs.readFileSync(new URL('../../../libs/shared/database/src/lib/gearset-schema.ts', import.meta.url), 'utf8');
  const table = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS public.gearsets'), ddl.indexOf(');', ddl.indexOf('CREATE TABLE IF NOT EXISTS public.gearsets')));
  const columns = [...table.matchAll(/^\s+([a-z_]+)\s+(?:uuid|numeric|varchar|text|boolean|timestamptz)/gm)].map((m) => m[1]);
  assert.deepEqual(columns, [...CANONICAL_GEARSET_COLUMNS]);
});
