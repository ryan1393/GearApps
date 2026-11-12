import { DEPARTMENT_CUTTERGRIND } from '@meshforge/manufacturing/shared/util-constants';

import { availableCoaterContainers, readCoaterManifest } from './coater-manifest';

/** Two complete packed sets (A, C) and one empty container (B), answered like PostgreSQL would. */
function fakeDatabase() {
  const containers = ['A', 'B', 'C'].map((name) => ({ id: `c-${name}`, serial_number: `CONT-${name}`, enabled: true, deletedAt: null }));
  const sets = [
    { id: 's-A', container_id: 'c-A', summary: '1.955FC', size: 2 },
    { id: 's-C', container_id: 'c-C', summary: '2.100FC', size: 3 },
  ].map((set) => ({
    id: set.id, container_id: set.container_id, required_blade_count: set.size, summary_id: `sum-${set.summary}`,
    part_type_id: 'pt-ring', from_tray: `TRAY-${set.id}`, summary: set.summary, summary_enabled: true, summary_deleted: null,
    part_type: 'RING', type_enabled: true, type_deleted: null, location: 'COATER-STAGING', location_enabled: true,
    location_deleted: null, location_department: DEPARTMENT_CUTTERGRIND, location_type: 'STAGING',
  }));
  const setBlades = sets.flatMap((set) => Array.from({ length: set.required_blade_count }, (_, index) => ({
    container_set_id: set.id, id: `${set.id}-b${index}`, serial_number: `${set.id}-B${index}`, status: 'ready_for_coating',
    service_cycle: 1, enabled: true, deletedAt: null, summary_id: set.summary_id, part_type_id: set.part_type_id,
    set_links: 1, tray_links: 0, cutter_links: 0,
  })));
  const calls: string[] = [];
  const query = jest.fn(async (sql: string, [ids]: [string[]]) => {
    calls.push(sql);
    if (/FROM containers/.test(sql)) return containers.filter((c) => ids.includes(c.id));
    if (/FROM container_tray ct/.test(sql)) return [];
    if (/FROM container_sets cs/.test(sql)) return sets.filter((s) => ids.includes(s.container_id));
    if (/FROM container_set_blades sb/.test(sql)) return setBlades.filter((b) => ids.includes(b.container_set_id));
    throw new Error(`Unexpected query ${sql}`);
  });
  return { manager: { query } as never, calls, containers };
}

describe('available coater containers', () => {
  it('matches one manifest per container while reading the manifest once', async () => {
    const { manager, calls, containers } = fakeDatabase();
    const expected = [];
    for (const container of containers) {
      const manifest = await readCoaterManifest(manager, [container.id]);
      if (manifest.issues.length || manifest.totals.containers !== 1) continue;
      expected.push({ id: container.id, serial: container.serial_number, trays: manifest.totals.trays, blades: manifest.totals.blades, summary: manifest.summary });
    }
    calls.length = 0;
    const batched = availableCoaterContainers(await readCoaterManifest(manager, containers.map((c) => c.id)), containers);
    expect(batched).toEqual(expected);
    expect(batched.map((c) => c.serial)).toEqual(['CONT-A', 'CONT-C']);
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});
