import { DataSource } from 'typeorm';
import { DsfCountService } from '../dsf-count.service';
import { DsfRefusal } from '../dsf-core';
import { CYCLES_SQL, DANA_MACHINES_SQL, MAPPING_SQL, ROLE_CHECK_SQL, SHIFTS_SQL, SOURCE_IDENTITY_SQL } from '../dsf-sql';
import { DsfHistoryService } from './dsf-history.service';
import * as source from './dsf-history-source';
import type { HistoryCapture, HistoryPlan } from './dsf-history-model';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('plant history shares the guarded DSF poll', () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks(); });

  function fixture() {
    Object.assign(process.env, { DSF_COUNT_ENABLED: 'true', DSF_HISTORY_ENABLED: 'true', DSF_CUTTER_WRITE_ENABLED: 'false',
      DSF_DB_HOST: 'dsf.test', DSF_DB_NAME: 'dsf', DSF_DB_USER: 'reader', DSF_DB_PASSWORD: 'unit-test', DSF_DB_SSL_MODE: 'disable', DSF_COUNT_MACHINES: '' });
    const at = new Date().toISOString();
    const starts = new Date(Date.now() - 3600000).toISOString();
    const ends = new Date(Date.now() + 3600000).toISOString();
    const machine = { machine_id: uuid(1), machine_number: 'G01', department: '45', machine_type: 'GRINDER', active: true };
    const mapping = { machine_id: machine.machine_id, mapping_id: uuid(10), whiteboard_id: uuid(20), op_id: uuid(30), line_id: uuid(40),
      department_id: uuid(50), department: '45', source_department: '45', line_name: 'G01', whiteboard_name: 'G01', enabled: true, revision: 1 };
    const sequence: string[] = [];
    const lease = { connect: jest.fn(), release: jest.fn(), query: jest.fn(async (sql: string) => {
      if (sql === DANA_MACHINES_SQL) return [machine];
      if (sql.includes('pg_try_advisory_lock')) return [{ held: true }];
      if (sql.includes('FROM public.dana_dsf_machine_mapping_v1')) return [mapping];
      if (sql.includes('AS installed')) return [{ installed: false }];
      return [];
    }) };
    const client = { connect: jest.fn(), end: jest.fn(async () => { sequence.push('source-closed'); }), on: jest.fn(),
      query: jest.fn(async (sql: string) => {
        let rows: unknown[] = [];
        if (sql === SOURCE_IDENTITY_SQL) rows = [{ is_source: true, not_meshforge: true, read_only: true, now_utc: at }];
        else if (sql === ROLE_CHECK_SQL) rows = [{ can_read: true, role_safe: true, no_database_create: true, no_schema_create: true, no_source_writes: true }];
        else if (sql.includes('session_login')) rows = [{ database_name: 'dsf', session_login: 'reader', effective_login: 'reader', read_only: true }];
        else if (sql.includes('substring(d.name')) rows = [{ ...mapping, department_name: 'CUTTER GRIND' }];
        else if (sql === MAPPING_SQL) rows = [{ ...mapping, department_name: 'CUTTER GRIND', op_name: 'GRIND', operation_line_matches: true,
          mapping_active: true, whiteboard_active: true, running_reasons: 1 }];
        else if (sql === SHIFTS_SQL) rows = [{ id: '90', number: 1, starts_at: starts, ends_at: ends, local_date: at.slice(0, 10) }];
        else if (sql === CYCLES_SQL) {
          const event = new Date(Date.now() - 1000).toISOString();
          rows = [{ id: '1', at: event, at_us: String(BigInt(Date.parse(event)) * 1000n), parts: 7, reason_code: '1', reason_op: mapping.op_id }];
        }
        sequence.push(sql);
        return { rows };
      }) };
    const plan = { system_key: 'a'.repeat(64), hours: [], backfill_hour: starts, backfill_start: starts } satisfies HistoryPlan;
    const capture = { system_key: plan.system_key, source_as_of: at, sources: [], hours: [], issues: [],
      backfill_start: starts, next_backfill_hour: starts } satisfies HistoryCapture;
    const history = { enabled: true, preparePlan: jest.fn().mockResolvedValue(plan),
      commitCapture: jest.fn(async () => { sequence.push('history-commit'); }),
      noteFailure: jest.fn(async () => { sequence.push('history-failure'); }) };
    const collect = jest.spyOn(source, 'collectDsfHistory').mockResolvedValue(capture);
    const service = new DsfCountService({ options: { type: 'postgres' }, query: jest.fn().mockResolvedValue([machine]),
      createQueryRunner: () => lease } as unknown as DataSource, history as unknown as DsfHistoryService);
    Object.assign(service, { schemaReady: true, makeClient: () => client });
    const poll = async () => {
      try { await (service as unknown as { poll(): Promise<void> }).poll(); }
      finally { service.onModuleDestroy(); }
    };
    return { service, client, history, sequence, collect, capture, poll };
  }

  it('stages on the same read-only connection and commits only after that connection closes', async () => {
    const f = fixture();
    await f.poll();
    expect(f.collect).toHaveBeenCalledWith(f.client, expect.any(String), expect.anything());
    expect(f.client.connect).toHaveBeenCalledTimes(1);
    expect(f.client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(f.sequence.indexOf('history-commit')).toBeGreaterThan(f.sequence.indexOf('source-closed'));
    expect(f.history.commitCapture).toHaveBeenCalledWith(f.capture);
    expect(f.service.snapshot().rows[0].count).toBe(7);
    for (const [sql] of f.client.query.mock.calls) expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
  });

  it('rolls back an optional history failure without losing the existing machine count', async () => {
    const f = fixture();
    f.collect.mockRejectedValue(new DsfRefusal('HISTORY_ROW_LIMIT'));
    await f.poll();
    expect(f.client.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT dsf_history_capture');
    expect(f.history.commitCapture).not.toHaveBeenCalled();
    expect(f.history.noteFailure).toHaveBeenCalledWith('HISTORY_ROW_LIMIT');
    expect(f.sequence.indexOf('history-failure')).toBeGreaterThan(f.sequence.indexOf('source-closed'));
    expect(f.service.snapshot().rows[0].count).toBe(7);
  });

  it('keeps current counts when a local history commit fails', async () => {
    const f = fixture();
    f.history.commitCapture.mockRejectedValue(new Error('local transaction unavailable'));
    await f.poll();
    expect(f.history.noteFailure).toHaveBeenCalledWith('HISTORY_LOCAL_COMMIT_FAILED');
    expect(f.service.snapshot().rows[0].count).toBe(7);
  });

  it('does not perform history reads or writes when history is disabled', async () => {
    const f = fixture();
    f.history.enabled = false;
    await f.poll();
    expect(f.collect).not.toHaveBeenCalled();
    expect(f.history.commitCapture).not.toHaveBeenCalled();
    expect(f.client.query).not.toHaveBeenCalledWith('SAVEPOINT dsf_history_capture');
  });
});
