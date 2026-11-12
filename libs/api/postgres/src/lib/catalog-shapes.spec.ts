import { buildGearsets, LIST_DEFAULT_LIMIT, PostgresLapperCatalog, Row } from './catalog';

/**
 * Pins what single-record reads return (the POST /machine-cycle and POST /macro-log responses
 * among them) now that they read only the rows they need instead of whole tables: every nested
 * machine and gearset must equal the same record in the full lists.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

const summaries: Row[] = [
  { id: id(901), number: '220', model_id: id(951), model_number: 'S-220', hos: '3.73', revision: 'B', active: true, enabled: true, deletedAt: null, createdBy: id(801) },
];
const parts: Row[] = [
  { id: id(101), part_number: 'GS-410', part_type: 'Gearset', summary_id: id(901), teeth: null, active: true, enabled: true, deletedAt: null, createdBy: id(801) },
  { id: id(102), part_number: 'R-41', part_type: 'Ring', summary_id: id(901), teeth: 41, active: true, enabled: true, deletedAt: null, createdBy: 'legacy' },
  { id: id(103), part_number: 'P-11', part_type: 'Pinion', summary_id: id(901), teeth: 11, active: true, enabled: true, deletedAt: null, createdBy: id(801) },
  { id: id(104), part_number: 'GS-500', part_type: 'Gearset', summary_id: id(901), teeth: null, active: true, enabled: false, deletedAt: null, createdBy: null },
  { id: id(105), part_number: 'UNRELATED', part_type: 'Ring', summary_id: null, teeth: 9, active: true, enabled: true, deletedAt: null, createdBy: null },
];
const publicGearsets: Row[] = [
  { id: id(201), gearset_part_id: id(101), ring_part_id: id(102), pinion_part_id: id(103), summary_id: id(901), ratio_value: '3.7273', ratio_text: '3.73 (41-11)', customer: 'Stellantis', application: 'JL', statuses: ['Production'], cut: '3-Axis', active: true, enabled: true, archived_at: null, created_by: id(801) },
  { id: id(202), gearset_part_id: id(104), ring_part_id: null, pinion_part_id: null, summary_id: id(901), ratio_value: null, ratio_text: null, customer: null, application: null, statuses: null, cut: null, active: true, enabled: true, archived_at: null, created_by: null },
];
const lapperGearsets: Row[] = [
  // Two override rows for 201: the first by id wins.
  { id: id(201), number: 'GS-410', rev: 'C', ratio: null, status: 'hold', user_id: id(802), public_gearset_id: id(201) },
  { id: id(299), number: 'GS-410', rev: 'Z', ratio: null, status: 'ignored', user_id: null, public_gearset_id: id(201) },
  // Pending numbers; 302 shares 301's number, 303 uses a MeshForge assembly's number.
  { id: id(301), number: ' 777 ', rev: null, ratio: '1.50000000', status: 'active', user_id: id(801), public_gearset_id: null },
  { id: id(302), number: '777', rev: null, ratio: null, status: 'active', user_id: null, public_gearset_id: null },
  { id: id(303), number: 'gs-500', rev: null, ratio: null, status: 'active', user_id: null, public_gearset_id: null },
];
const machines: Row[] = [
  { id: id(401), machine_ip: '10.0.0.1', type: 'L-60', builder: 'K', status: 'active', argonaut_url: null, argonaut_location_id: 'loc', public_machine_id: id(501), api_id: id(501), api_number: '01-094-101', api_cell: 15, api_description: 'Lapper 1', api_active: true, api_enabled: true, department_code: '181' },
  { id: id(402), machine_ip: '10.0.0.2', type: null, builder: null, status: 'active', argonaut_url: null, argonaut_location_id: null, public_machine_id: id(502), api_id: id(502), api_number: '01-094-102', api_cell: null, api_description: null, api_active: true, api_enabled: false, department_code: '181' },
];
const scanners: Row[] = [
  { id: id(601), machine_id: id(401), ip: '10.0.1.1', model: 'SR', type: 'Barcode', description: null, sn_procces: 'A', sn_queue: null, sn_scanner: 'B', status: 'Active' },
  { id: id(602), machine_id: id(401), ip: '10.0.1.2', model: 'SR', type: 'Barcode', description: 'second', sn_procces: null, sn_queue: null, sn_scanner: null, status: 'Active' },
];
const macros: Row[] = [
  { id: id(701), number: 10039, name: 'Torque', status: 1, type: 'float', tab_index: 1, used_form: 'general_data', l60_table: 'T', extra: null, min_value: '0.00000', max_value: '12.50000', unit: 'Nm', flag_changes: true },
  { id: id(702), number: 10032, name: 'consec', status: 1, type: 'int', tab_index: 2, used_form: null, l60_table: 'T', extra: null, min_value: null, max_value: null, unit: null, flag_changes: false },
];
// Raw cycle rows as cycleQuery selects them (already resolved to API ids).
const cycles: Row[] = [
  { id: id(1001), consec: 42, serial_number: 'SN-1', occurred_at: new Date('2026-11-09T18:42:13.123Z'), cycle_time_s: '124.250', api_machine_id: id(501), api_gearset_id: id(201) },
  { id: id(1002), consec: 43, serial_number: null, occurred_at: new Date('2026-11-09T18:40:00Z'), cycle_time_s: null, api_machine_id: id(502), api_gearset_id: id(301) },
  { id: id(1003), consec: 44, serial_number: 'SN-3', occurred_at: new Date('2026-11-09T18:30:00Z'), cycle_time_s: null, api_machine_id: id(501), api_gearset_id: id(302) },
  { id: id(1004), consec: 45, serial_number: 'SN-4', occurred_at: new Date('2026-11-09T18:20:00Z'), cycle_time_s: null, api_machine_id: id(501), api_gearset_id: id(202) },
];
const logs: Row[] = [
  { id: id(1101), machine_cycle_id: id(1001), macro_id: id(701), value: '-12.34567' },
  { id: id(1102), machine_cycle_id: id(1002), macro_id: id(702), value: '43.00000' },
];

/** Big tables a single-record read must not load whole. */
const BIG = ['public.gearsets', 'lapper.gearsets', 'public.parts', 'public.part_summaries', 'lapper.machines', 'lapper.scanners', 'lapper.macros', 'lapper.machine_cycles'];

function fakeDb() {
  const reads: Array<{ table: string; filtered: boolean }> = [];
  const rowsFor = (table: string, p: Record<string, unknown>, limit?: number, offset?: number): Row[] => {
    const inList = (key: string) => (p[key] as unknown[] | undefined) ?? null;
    const byId = (rows: Row[]) => [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    switch (table) {
      case 'public.part_summaries': {
        const ids = inList('summaryIds');
        return summaries.filter((s) => !ids || ids.includes(s.id));
      }
      case 'public.parts': {
        const ids = inList('partIds');
        return parts.filter((x) => !ids || ids.includes(x.id));
      }
      case 'public.gearsets': {
        if (p['numbers']) {
          const numbers = p['numbers'] as string[];
          return publicGearsets
            .map((g) => parts.find((x) => x.id === g.gearset_part_id))
            .filter((x): x is Row => !!x && numbers.includes(norm(x.part_number)))
            .map((x) => ({ number: x.part_number }));
        }
        const gearIds = inList('gearIds');
        const partIds = inList('partIds');
        return publicGearsets.filter(
          (g) => (!gearIds || gearIds.includes(g.id)) && (!partIds || partIds.includes(g.gearset_part_id)),
        );
      }
      case 'lapper.gearsets': {
        const gearIds = inList('gearIds');
        const numbers = p['numbers'] as string[] | undefined;
        return byId(
          lapperGearsets.filter((g) =>
            numbers
              ? !g.public_gearset_id && numbers.includes(norm(g.number))
              : !gearIds || gearIds.includes(g.public_gearset_id) || gearIds.includes(g.id),
          ),
        );
      }
      case 'lapper.machines': {
        const ids = inList('machineIds');
        return machines.filter((m) => !ids || ids.includes(m.api_id));
      }
      case 'lapper.scanners': {
        const ids = inList('profileIds');
        return byId(scanners.filter((s) => !ids || ids.includes(s.machine_id)));
      }
      case 'lapper.macros': {
        const ids = inList('macroIds');
        return macros.filter((m) => !ids || ids.includes(m.id)).map((m) => ({ ...m }));
      }
      case 'lapper.machine_cycles': {
        const ids = inList('ids');
        const rows = cycles.filter((c) => (!p['id'] || c.id === p['id']) && (!ids || ids.includes(c.id)));
        return rows.slice(offset ?? 0, limit === undefined ? undefined : (offset ?? 0) + limit).map((c) => ({ ...c }));
      }
      case 'lapper.macro_logs': {
        const rows = logs.filter((l) => !p['id'] || l.id === p['id']);
        return rows.slice(offset ?? 0, limit === undefined ? undefined : (offset ?? 0) + limit).map((l) => ({ ...l }));
      }
      default:
        throw new Error('unexpected table ' + table);
    }
  };
  const createQueryBuilder = () => {
    let table = '';
    let limit: number | undefined;
    let offset: number | undefined;
    const params: Record<string, unknown> = {};
    const qb: Record<string, unknown> = {};
    const chain = () => qb;
    for (const name of ['select', 'addSelect', 'innerJoin', 'leftJoin', 'orderBy', 'addOrderBy', 'distinct'])
      qb[name] = chain;
    qb['from'] = (t: string) => ((table = t), qb);
    for (const name of ['where', 'andWhere', 'orWhere'])
      qb[name] = (_sql: string, values?: Record<string, unknown>) => (Object.assign(params, values ?? {}), qb);
    qb['setParameter'] = (key: string, value: unknown) => ((params[key] = value), qb);
    qb['setParameters'] = (values: Record<string, unknown>) => (Object.assign(params, values), qb);
    qb['limit'] = (n: number) => ((limit = n), qb);
    qb['offset'] = (n: number) => ((offset = n), qb);
    qb['getRawMany'] = async () => {
      const filtered = ['summaryIds', 'partIds', 'gearIds', 'numbers', 'machineIds', 'profileIds', 'macroIds', 'id', 'ids'].some((k) => k in params) || limit !== undefined;
      reads.push({ table, filtered });
      return rowsFor(table, params, limit, offset);
    };
    qb['getRawOne'] = async () => ((await (qb['getRawMany'] as () => Promise<Row[]>)())[0]);
    return qb;
  };
  const manager = { createQueryBuilder };
  return { db: { manager }, reads };
}

const catalogWith = () => {
  const { db, reads } = fakeDb();
  const catalog = new PostgresLapperCatalog(db as never, { get: () => 'America/Indiana/Indianapolis' } as never);
  return { catalog, reads };
};

describe('Lapper single-record reads', () => {
  it('return each cycle with the same machine and gearset as the full lists, without loading whole tables', async () => {
    const { catalog, reads } = catalogWith();
    const allMachines = await catalog.machines();
    const allGearsets = await catalog.gearsets();
    for (const cycle of cycles) {
      reads.length = 0;
      const one = await catalog.one('machine-cycle', String(cycle.id));
      expect(one['machine']).toEqual(allMachines.find((m) => m['id'] === cycle['api_machine_id']));
      expect(one['gearset']).toEqual(allGearsets.find((g) => g['id'] === cycle['api_gearset_id']));
      expect(reads.filter((r) => BIG.includes(r.table) && !r.filtered)).toEqual([]);
    }
  });

  it('keeps the cycle response shape', async () => {
    const { catalog } = catalogWith();
    const cycle = await catalog.one('machine-cycle', id(1001));
    expect(JSON.parse(JSON.stringify(cycle))).toEqual({
      id: id(1001),
      consec: 42,
      serial_number: 'SN-1',
      timestamp: '2026-11-09T18:42:13.123Z',
      cycle_time_s: 124.25,
      machine_id: id(501),
      machine: {
        id: id(501), legacy_id: id(401), number: '01-094-101', ip: '10.0.0.1', dept_id: '181',
        description: 'Lapper 1', type: 'L-60', builder: 'K', cell: '15', status: 'active',
        scanner_id: id(601),
        scanner: { ...scanners[0], machine_id: id(501) },
        argonaut_url: null, argonaut_location_id: 'loc',
      },
      gearset_id: id(201),
      gearset: {
        id: id(201), number: 'GS-410', rev: 'C', ratio: 3.7273, status: 'hold', summary_id: id(901),
        summary: { id: id(901), number: '220', model: 'S-220', hos: '3.73', revision: 'B', status: 'active', user_id: id(801) },
        ring_id: id(102),
        ring: {
          id: id(102), number: 'R-41', type: 'Ring', summary_id: id(901),
          summary: { id: id(901), number: '220', model: 'S-220', hos: '3.73', revision: 'B', status: 'active', user_id: id(801) },
          teeth: 41, status: 'active', user_id: null, ring_id: null, pinion_id: null,
        },
        pinion_id: id(103),
        pinion: {
          id: id(103), number: 'P-11', type: 'Pinion', summary_id: id(901),
          summary: { id: id(901), number: '220', model: 'S-220', hos: '3.73', revision: 'B', status: 'active', user_id: id(801) },
          teeth: 11, status: 'active', user_id: id(801), ring_id: null, pinion_id: null,
        },
        user_id: id(802), ratio_text: '3.73 (41-11)', model: 'S-220', customer: 'Stellantis', application: 'JL',
        business_statuses: ['Production'], cut: '3-Axis', archived: false,
      },
    });
  });

  it('lists a pending number once, under its first row, and never one an assembly already uses', async () => {
    const { catalog } = catalogWith();
    expect((await catalog.one('machine-cycle', id(1002)))['gearset']).toEqual({
      ...lapperGearsets[2],
      ratio: 1.5,
    });
    expect((await catalog.one('machine-cycle', id(1003)))['gearset']).toBeUndefined();
    const all = await catalog.gearsets();
    expect(all.map((g) => g['id'])).toEqual([id(301), id(201), id(202)]);
    expect(await catalog.gearsets(undefined, [id(303)])).toEqual([]);
  });

  it('keeps the macro log response shape', async () => {
    const { catalog, reads } = catalogWith();
    reads.length = 0;
    const log = await catalog.one('macro-log', id(1101));
    expect(reads.filter((r) => BIG.includes(r.table) && !r.filtered)).toEqual([]);
    expect(Object.keys(log)).toEqual(['id', 'machine_cycle_id', 'macro_id', 'value', 'macro', 'machine_cycle']);
    expect(log['value']).toBe(-12.34567);
    expect(log['macro']).toEqual({ ...macros[0], min_value: 0, max_value: 12.5 });
    expect(log['machine_cycle']).toEqual(await catalog.one('machine-cycle', id(1001)));
  });

  it('caps the unpaged cycle and macro value lists at the newest 1,000 and pages them', async () => {
    const { catalog, reads } = catalogWith();
    reads.length = 0;
    await catalog.list('machine-cycle');
    await catalog.list('macro-log');
    expect(LIST_DEFAULT_LIMIT).toBe(1000);
    expect(reads.filter((r) => ['lapper.machine_cycles', 'lapper.macro_logs'].includes(r.table) && !r.filtered)).toEqual([]);
    expect((await catalog.cyclePage(2, 3)).map((c) => c['id'])).toEqual([id(1004)]);
    expect((await catalog.logs(undefined, undefined, { page: 1, pageSize: 1 })).map((l) => l['id'])).toEqual([id(1101)]);
  });
});

describe('buildGearsets', () => {
  it('uses the first override row by id, as before', () => {
    const [gear] = buildGearsets(publicGearsets.slice(0, 1), lapperGearsets.slice(0, 2), []);
    expect(gear).toBeUndefined(); // no parts: not listed
    const built = buildGearsets(
      publicGearsets.slice(0, 1),
      lapperGearsets.slice(0, 2),
      [{ id: id(101), number: 'GS-410', summary: undefined }],
    );
    expect(built[0]).toMatchObject({ rev: 'C', status: 'hold', user_id: id(802) });
  });
});
