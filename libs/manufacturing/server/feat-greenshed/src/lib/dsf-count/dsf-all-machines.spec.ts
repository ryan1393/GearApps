import { DataSource } from 'typeorm';
import { DsfCountService } from './dsf-count.service';
import { CYCLES_SQL, DANA_MACHINES_NO_LAPPER_SCHEMA_SQL, DANA_MACHINES_SQL, LAPPER_MACHINES_TABLE_SQL, MAPPING_SQL, ROLE_CHECK_SQL, SHIFTS_SQL, SOURCE_IDENTITY_SQL } from './dsf-sql';
import * as writer from './dsf-cutter-attribution';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const machines = [
  { machine_id: uuid(1), machine_number: 'G01', department: '45', machine_type: 'GRINDER', active: true },
  { machine_id: uuid(2), machine_number: 'L01', department: '181', machine_type: 'PRODUCTION', active: true },
  { machine_id: uuid(3), machine_number: 'G02', department: '132', machine_type: 'GRINDER', active: true },
];
// The MeshForge catalog as the machines query sees it: Lapper machines are left out by DANA_MACHINES_SQL.
const catalog = (rows: unknown[], lapperSchema = true) => jest.fn(async (sql: string) =>
  sql === LAPPER_MACHINES_TABLE_SQL ? [{ present: lapperSchema }] : rows);
const options = machines.map((m, i) => ({ machine_id: m.machine_id, mapping_id: uuid(10+i), whiteboard_id: uuid(20+i), op_id: uuid(30+i), line_id: uuid(40+i), department_id: uuid(50+i), department: m.department, source_department: m.department, line_name: m.machine_number, whiteboard_name: m.machine_number, enabled: true, revision: 1 }));

describe('DSF counts across machine departments', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });
  it('lists inactive and unconfigured machines without inventing zero counts', async () => {
    process.env['DSF_COUNT_ENABLED'] = 'false';
    const query = catalog([...machines, { ...machines[0], machine_id: uuid(4), active: false }]);
    const service = new DsfCountService({ options: { type: 'postgres' }, query } as unknown as DataSource);
    await service.onModuleInit();
    const rows = service.snapshot().rows;
    expect(rows.map(row => row.department)).toEqual(['45', '181', '132', '45']);
    expect(rows.every(row => row.count === null)).toBe(true);
    expect(rows[0].status).toBe('NOT_CONFIGURED');
    expect(rows[3].status).toBe('INACTIVE');
    expect(query).toHaveBeenCalledWith(DANA_MACHINES_SQL);
  });
  it('reads approved grinder and other department operations, without crediting cutters, and discovers sources before any mapping exists', async () => {
    Object.assign(process.env, { DSF_COUNT_ENABLED: 'true', DSF_CUTTER_WRITE_ENABLED: 'true', DSF_DB_HOST: 'dsf.test', DSF_DB_NAME: 'dsf', DSF_DB_USER: 'reader', DSF_DB_PASSWORD: 'test', DSF_DB_SSL_MODE: 'disable', DSF_COUNT_MACHINES: '' });
    const now = new Date();
    const at = now.toISOString();
    const start = new Date(now.getTime()-3600000).toISOString();
    const end = new Date(now.getTime()+3600000).toISOString();
    let overrides = options;
    const lease = { connect: jest.fn(), release: jest.fn(), query: jest.fn(async (sql: string) => {
      if (sql === LAPPER_MACHINES_TABLE_SQL) return [{ present: true }];
      if (sql === DANA_MACHINES_SQL) return machines;
      if (sql.includes('pg_try_advisory_lock')) return [{ held: true }];
      if (sql.includes('FROM public.dana_dsf_machine_mapping_v1')) return overrides;
      if (sql.includes('AS installed')) return [{ installed: false }];
      return [];
    }) };
    const client = { connect: jest.fn(), end: jest.fn(), on: jest.fn(), query: jest.fn(async (sql: string, params?: string[]) => {
      let rows: unknown[] = [];
      if (sql === SOURCE_IDENTITY_SQL) rows = [{ is_source: true, not_meshforge: true, read_only: true, now_utc: at }];
      else if (sql === ROLE_CHECK_SQL) rows = [{ can_read: true, role_safe: true, no_database_create: true, no_schema_create: true, no_source_writes: true }];
      else if (sql.includes('session_login')) rows = [{ database_name: 'dsf', session_login: 'reader', effective_login: 'reader', read_only: true }];
      // DSF names the grinders' department CUTTER GRIND, not "Dept. 45".
      else if (sql.includes('substring(d.name')) rows = options.map(o => o.department === '45' ? { ...o, department: null, department_name: 'CUTTER GRIND' } : { ...o, department_name: `Dept. ${o.department}` });
      else if (sql === MAPPING_SQL) {
        const option = options.find(row => row.mapping_id === params?.[0])!;
        rows = [{ ...option, department_name: option.department === '45' ? 'CUTTER GRIND' : `Dept. ${option.department}`, op_name: 'GRIND_OR_LAP', operation_line_matches: true, mapping_active: true, whiteboard_active: true, running_reasons: 1 }];
      } else if (sql === SHIFTS_SQL) rows = [{ id: uuid(90), number: 1, starts_at: start, ends_at: end, local_date: at.slice(0,10) }];
      else if (sql === CYCLES_SQL) {
        const option = options.find(row => row.mapping_id === params?.[1])!;
        const event = new Date(now.getTime()-1000).toISOString();
        rows = [{ id: '1', at: event, at_us: String(BigInt(now.getTime()-1000)*1000n), parts: 7, reason_code: '1', reason_op: option.op_id }];
      }
      return { rows };
    }) };
    const apply = jest.spyOn(writer, 'applyDsfCutterCounts').mockResolvedValue(new Map());
    const service = new DsfCountService({ options: { type: 'postgres' }, query: catalog(machines), createQueryRunner: () => lease } as unknown as DataSource);
    // Exercise the serialized poll with a fake read-only source; no plant network required.
    Object.assign(service, { schemaReady: true, makeClient: () => client });
    await (service as unknown as { poll(): Promise<void> }).poll();
    expect(service.snapshot().rows.map(row => [row.department, row.status, row.count])).toEqual([['45', 'OK', 7], ['181', 'OK', 7], ['132', 'OK', 7]]);
    expect(apply).toHaveBeenLastCalledWith(expect.anything(), []);
    overrides = [];
    await (service as unknown as { poll(): Promise<void> }).poll();
    expect((await service.adminSnapshot()).source_options.map(o => o.department)).toEqual(['45', '181', '132']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('substring(d.name'), [['CUTTER GRIND']]);
    expect(service.snapshot().rows.every(row => row.count === null)).toBe(true);
    expect(client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    service.onModuleDestroy();
  });
  it('leaves Lapper machines out of DSF counts, and reads every machine before the Lapper schema exists', async () => {
    process.env['DSF_COUNT_ENABLED'] = 'false';
    const query = catalog(machines);
    const service = new DsfCountService({ options: { type: 'postgres' }, query } as unknown as DataSource);
    await service.onModuleInit();
    expect(query).toHaveBeenCalledWith(DANA_MACHINES_SQL);
    expect(DANA_MACHINES_SQL).toContain('NOT EXISTS (SELECT 1 FROM lapper.machines l WHERE l.public_machine_id=m.id)');
    const early = catalog(machines, false);
    await new DsfCountService({ options: { type: 'postgres' }, query: early } as unknown as DataSource).onModuleInit();
    expect(early).toHaveBeenCalledWith(DANA_MACHINES_NO_LAPPER_SCHEMA_SQL);
    expect(early).not.toHaveBeenCalledWith(DANA_MACHINES_SQL);
  });
  it('refuses to map a DSF source to a Lapper machine', async () => {
    process.env['DSF_COUNT_ENABLED'] = 'false';
    const lapper = { machine_id: uuid(5), machine_number: 'L60', department: '181', machine_type: 'PRODUCTION', active: true };
    const manager = { query: jest.fn(async (sql: string) => {
      if (sql === LAPPER_MACHINES_TABLE_SQL) return [{ present: true }];
      if (sql === DANA_MACHINES_SQL) return machines; // the Lapper machine is left out
      if (sql.includes('FOR UPDATE OF m')) return [lapper];
      return [];
    }) };
    const service = new DsfCountService({ options: { type: 'postgres' }, query: catalog(machines),
      transaction: async (work: (m: typeof manager) => Promise<void>) => work(manager) } as unknown as DataSource);
    Object.assign(service, { sourceOptions: [{ ...options[1], mapping_active: true, whiteboard_active: true, operation_line_matches: true, active_mappings: 1, running_reasons: 1 }],
      sourceOptionsRefreshedAt: new Date().toISOString() });
    await expect(service.saveAdminMapping(lapper.machine_id, options[1].mapping_id, uuid(99))).rejects.toThrow('Lapper machines do not use DSF counts.');
    expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public.dana_dsf_machine_mapping_v1'), expect.anything());
  });
});
