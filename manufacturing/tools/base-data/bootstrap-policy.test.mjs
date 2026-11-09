import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldImportBaseData } from './bootstrap-policy.mjs';

for (const [label, automatic, populated, expected, calls] of [
  ['automatic bootstrap initializes empty master data', true, false, true, 2],
  ['automatic bootstrap preserves existing operational edits', true, true, false, 2],
  ['explicit import can refresh existing master data', false, true, true, 1],
]) {
  test(label, async () => {
    const queries = [];
    const client = { query: async sql => { queries.push(sql); return { rows: [{ initialized: populated }] }; } };
    assert.equal(await shouldImportBaseData(client, automatic), expected);
    assert.equal(queries.length, calls);
    assert.match(queries[0], /pg_advisory_xact_lock/);
    if (calls === 2) for (const table of ['departments', 'models', 'machines', 'part_summaries', 'parts', 'roll_masters', 'cutter_bodies']) assert.ok(queries[1].includes(`public.${table}`));
  });
}
test('failed inspection aborts instead of importing over an unknown state', async () => {
  let calls = 0;
  const client = { query: async () => { if (++calls === 2) throw new Error('database unavailable'); } };
  await assert.rejects(shouldImportBaseData(client, true), /database unavailable/);
});
