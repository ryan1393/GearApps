import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const fixtureUrl = process.env.DSF_HISTORY_TEST_DATABASE_URL;
const integration = { skip: !fixtureUrl };
const hash = value => createHash('sha256').update(value).digest('hex');
const SYSTEM = hash('synthetic-dsf-system');
const HOUR = '2026-11-11T20:00:00.000000Z';
const END = '2026-11-11T21:00:00.000000Z';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const quote = value => '"' + value.replaceAll('"', '""') + '"';
let loaded;

function localTestUrl(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Use a PostgreSQL test URL.');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Integration fixtures require an explicit loopback test database.');
  return url;
}

function modules() {
  if (loaded) return loaded;
  require('ts-node').register({
    transpileOnly: true,
    project: resolve(root, 'apps/server/tsconfig.app.json'),
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
  });
  const config = JSON.parse(readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8'));
  require('tsconfig-paths').register({ baseUrl: root, paths: config.compilerOptions.paths });
  const base = resolve(root, 'libs/manufacturing/server/feat-greenshed/src/lib/dsf-count/history');
  loaded = {
    ...require(resolve(base, 'dsf-history-source.ts')),
    DataSource: require('typeorm').DataSource,
  };
  Object.defineProperties(loaded, {
    DsfHistoryStore: { get: () => require(resolve(base, 'dsf-history-store.ts')).DsfHistoryStore },
    ensureDsfHistorySchema: { get: () => require(resolve(base, 'dsf-history-schema.ts')).ensureDsfHistorySchema },
  });
  return loaded;
}

/** Only the uniquely created database is disposable; the supplied database is never cleared. */
async function withDatabase(run) {
  const original = localTestUrl(fixtureUrl);
  const database = 'gearapps_dsf_history_test_' + randomUUID().replaceAll('-', '');
  assert.match(database, /^gearapps_dsf_history_test_[a-f0-9]{32}$/);
  const admin = new pg.Client({ connectionString: original.toString() });
  await admin.connect();
  let source;
  let client;
  let created = false;
  try {
    await admin.query('CREATE DATABASE ' + quote(database));
    created = true;
    const isolated = new URL(original);
    isolated.pathname = '/' + database;
    client = new pg.Client({ connectionString: isolated.toString() });
    await client.connect();
    const { DataSource } = modules();
    source = new DataSource({ type: 'postgres', url: isolated.toString(), entities: [], synchronize: false, logging: false, extra: { max: 1 } });
    await source.initialize();
    await run({ database: source, client, connection: isolated.toString() });
  } finally {
    if (source?.isInitialized) await source.destroy();
    if (client) await client.end();
    if (created) await admin.query('DROP DATABASE ' + quote(database) + ' WITH (FORCE)');
    await admin.end();
  }
}

const DSF_COLUMNS = {
  tbl_department: 'id uuid PRIMARY KEY, name text, timestamp timestamptz',
  tbl_line: 'id uuid PRIMARY KEY, name text, display_name text, loc_id uuid, area_id uuid, department_id uuid, cell_id uuid, asset_number text',
  tbl_op: 'id uuid PRIMARY KEY, name text, display_name text, line_id uuid, asset_number text',
  tbl_whiteboard: 'id uuid PRIMARY KEY, name text, active boolean, shopfloor_by_shift boolean',
  tbl_whiteboard_machines: 'id uuid PRIMARY KEY, whiteboard_id uuid, op_id uuid, line_id uuid, active boolean',
  tbl_op_state_reason: 'id integer PRIMARY KEY, op_id uuid, code integer, name text, color text, active boolean, running boolean, fttloss boolean, downtime boolean',
  tbl_shift: 'id integer PRIMARY KEY, line_id uuid, shift integer, start_of_day boolean, start_time timestamptz(4), end_time timestamptz(4), timestamp timestamptz(4)',
  tbl_whiteboard_cycles_master: 'id integer, whiteboard_id uuid, machine_id uuid, code integer, length integer, timestamp timestamptz(4), part_count integer, PRIMARY KEY (id,timestamp)',
};

async function withDsf(run) {
  localTestUrl(fixtureUrl);
  const client = new pg.Client({ connectionString: fixtureUrl });
  await client.connect();
  try {
    for (const [table, columns] of Object.entries(DSF_COLUMNS)) await client.query(`CREATE TEMP TABLE ${table} (${columns})`);
    const result = await client.query('SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()');
    const schema = result.rows[0].nspname;
    assert.match(schema, /^pg_temp_\d+$/);
    const adapter = { query: (sql, params) => client.query(sql.replace(/\bpublic\b/g, schema), params) };
    await run({ client, adapter });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

async function seedSource(client, n, name = `Fixture ${n}`, department = 'Dept. 181', overrides = {}) {
  const source = {
    mapping_id: uuid(n), whiteboard_id: uuid(n + 1000), op_id: uuid(n + 2000),
    line_id: uuid(n + 3000), department_id: uuid(n + 4000), name, department,
    ...overrides,
  };
  await client.query('INSERT INTO pg_temp.tbl_department (id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [source.department_id, department]);
  await client.query('INSERT INTO pg_temp.tbl_line (id,name,display_name,department_id,asset_number) VALUES ($1,$2,$2,$3,$4) ON CONFLICT DO NOTHING', [source.line_id, `Line ${name}`, source.department_id, `Asset ${n}`]);
  await client.query('INSERT INTO pg_temp.tbl_op (id,name,display_name,line_id,asset_number) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [source.op_id, 'OP10', name, source.line_id, `Asset ${n}`]);
  await client.query('INSERT INTO pg_temp.tbl_whiteboard (id,name,active,shopfloor_by_shift) VALUES ($1,$2,true,true)', [source.whiteboard_id, name]);
  await client.query('INSERT INTO pg_temp.tbl_whiteboard_machines VALUES ($1,$2,$3,$4,true)', [source.mapping_id, source.whiteboard_id, source.op_id, source.line_id]);
  await client.query('INSERT INTO pg_temp.tbl_op_state_reason (id,op_id,code,name,active,running,fttloss,downtime) VALUES ($1,$2,1,$3,true,true,false,false) ON CONFLICT DO NOTHING', [n + 10000, source.op_id, 'Running']);
  return source;
}

async function seedEvent(client, source, id, at, parts = 1, reason = Number(source.mapping_id.slice(-12)) + 10000, board = source.whiteboard_id) {
  await client.query('INSERT INTO pg_temp.tbl_whiteboard_cycles_master VALUES ($1,$2,$3,$4,100,$5,$6)', [id, board, source.mapping_id, reason, at, parts]);
}

async function seedMeshForge(client) {
  await client.query(`CREATE TABLE public.departments (id uuid PRIMARY KEY,code text,active boolean DEFAULT true,enabled boolean DEFAULT true,"deletedAt" timestamptz);
    CREATE TABLE public.machines (id uuid PRIMARY KEY,machine_number text,department_id uuid,active boolean DEFAULT true,enabled boolean DEFAULT true,"deletedAt" timestamptz);
    CREATE TABLE public.cutter_machine_runs (id uuid PRIMARY KEY);
    CREATE TABLE public.dana_dsf_machine_mapping_v1 (machine_id uuid PRIMARY KEY,mapping_id uuid,whiteboard_id uuid,op_id uuid,line_id uuid,department_id uuid,source_department text,line_name text,whiteboard_name text,enabled boolean DEFAULT true,revision bigint DEFAULT 1)`);
}

test('history fixture connections are explicitly local and use isolated storage', () => {
  assert.throws(() => localTestUrl('postgresql://reader@example.invalid/maindblocal'));
  assert.throws(() => localTestUrl('https://localhost/test'));
  assert.equal(localTestUrl('postgresql://127.0.0.1/test').hostname, '127.0.0.1');
});

// Actual collector and store scenarios are below. They only run when an explicitly
// configured local PostgreSQL fixture connection is provided by the caller.

function historySource(n, overrides = {}) {
  const source = {
    system_key: SYSTEM,
    mapping_id: uuid(n), whiteboard_id: uuid(n + 1000), op_id: uuid(n + 2000), line_id: uuid(n + 3000),
    department_id: uuid(n + 4000), source_name: `Fixture source ${n}`, line_name: `Fixture line ${n}`,
    department_name: 'CUTTER GRIND', asset_number: `Fixture asset ${n}`, active: true,
    duplicate_operation: false, review_reason: null, ...overrides,
  };
  source.source_key = hash(JSON.stringify([source.system_key, source.mapping_id, source.whiteboard_id, source.op_id, source.line_id, source.department_id]));
  return source;
}

function capture(sources, counts, options = {}) {
  const hour = options.hour ?? HOUR;
  const end = options.end ?? END;
  return {
    system_key: SYSTEM, source_as_of: options.asOf ?? END, sources,
    backfill_start: options.backfillStart ?? HOUR,
    next_backfill_hour: options.nextBackfill ?? END,
    issues: options.issues ?? [],
    hours: sources.filter(source => Object.hasOwn(counts, source.source_key)).map(source => ({
      source_key: source.source_key, hour_start: hour, covered_to: end,
      count: counts[source.source_key], source_rows: counts[source.source_key],
      last_production_at: counts[source.source_key] ? new Date(Date.parse(end) - 1).toISOString() : null,
      slices: [{ source_key: source.source_key, hour_start: hour, slice_start: hour, slice_end: end,
        shift_id: '501', shift_number: 2, shift_date: '2026-11-11', shift_start: HOUR,
        shift_end: '2026-11-12T04:00:00.000000Z', count: counts[source.source_key] }],
    })),
  };
}

const reportQuery = extra => ({ from: '2026-11-11', to: '2026-11-11', group: 'hour', include_inactive: true, ...extra });
const sourceRow = (report, source) => {
  const rows = report.rows.filter(row => row.source_key === source.source_key && Date.parse(row.period_start) === Date.parse(HOUR));
  assert.equal(rows.length, 1, 'one source/hour record expected');
  return rows[0];
};

test('PostgreSQL history schema refuses a DSF-shaped destination and preserves it', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    await client.query('CREATE TABLE public.tbl_whiteboard_cycles_master (id integer)');
    await assert.rejects(modules().ensureDsfHistorySchema(database));
    assert.equal((await client.query("SELECT to_regclass('public.dana_dsf_history_hour_v1') IS NULL AS absent")).rows[0].absent, true);
    assert.equal((await client.query("SELECT to_regclass('public.tbl_whiteboard_cycles_master') IS NOT NULL AS retained")).rows[0].retained, true);
  });
});

test('PostgreSQL history persists across restart and replaces corrections without duplicate polling totals', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const { DsfHistoryStore } = modules();
    const store = new DsfHistoryStore(database);
    await store.ensure();
    const source = historySource(1);
    const original = capture([source], { [source.source_key]: 7 });
    await store.commit(original);
    await store.commit(original);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.dana_dsf_history_hour_v1')).rows[0].n, 1);
    const restarted = new DsfHistoryStore(database);
    await restarted.ensure();
    assert.equal(sourceRow(await restarted.report(reportQuery()), source).count, 7);
    await restarted.commit(capture([source], { [source.source_key]: 4 }));
    assert.equal(sourceRow(await restarted.report(reportQuery()), source).count, 4);
    await restarted.commit(capture([source], { [source.source_key]: 0 }));
    const corrected = sourceRow(await new DsfHistoryStore(database).report(reportQuery()), source);
    assert.equal(corrected.count, 0);
    assert.equal(corrected.completeness, 'COMPLETE');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.dana_dsf_history_hour_v1')).rows[0].n, 1);
  });
});

test('PostgreSQL history restart resumes the persisted scan gap after an outage beyond the rolling lookback', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const { DsfHistoryStore } = modules();
    const store = new DsfHistoryStore(database);
    await store.ensure();
    const source = historySource(1);
    await store.commit(capture([source], { [source.source_key]: 7 }));
    const restarted = new DsfHistoryStore(database);
    const plan = await restarted.plan('2026-11-20T18:04:00Z', SYSTEM, 1);
    assert.equal(plan.backfill_start, HOUR);
    assert.equal(plan.backfill_hour, END);
    assert.ok(plan.hours.includes(END), 'An old persisted gap must not be skipped to the newer rolling lookback.');
    assert.ok(plan.hours.includes('2026-11-20T18:00:00.000000Z'));
    assert.ok(plan.hours.includes('2026-11-20T17:00:00.000000Z'));
    assert.equal(sourceRow(await restarted.report(reportQuery()), source).count, 7);
  });
});

test('PostgreSQL history rolls back a failed commit together with its progress and prior count', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const { DsfHistoryStore } = modules();
    const store = new DsfHistoryStore(database);
    await store.ensure();
    const source = historySource(1);
    await store.commit(capture([source], { [source.source_key]: 7 }));
    const before = (await client.query('SELECT * FROM public.dana_dsf_history_state_v1 ORDER BY system_key')).rows;
    const failingDatabase = Object.create(database);
    failingDatabase.transaction = work => database.transaction(async manager => {
      await work(manager);
      throw new Error('Synthetic failure before transaction commit');
    });
    await assert.rejects(new DsfHistoryStore(failingDatabase).commit(capture([source], { [source.source_key]: 20 }, { asOf: '2026-11-11T22:01:00.000000Z', nextBackfill: '2026-11-11T22:00:00.000000Z' })), /Synthetic failure/);
    assert.equal(sourceRow(await store.report(reportQuery()), source).count, 7);
    assert.deepEqual((await client.query('SELECT * FROM public.dana_dsf_history_state_v1 ORDER BY system_key')).rows, before);
  });
});

test('PostgreSQL history keeps source generations and distinguishes an unread hour from verified zero', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const { DsfHistoryStore } = modules();
    const store = new DsfHistoryStore(database);
    await store.ensure();
    const oldSource = historySource(1);
    const unread = historySource(2);
    await store.commit(capture([oldSource, unread], { [oldSource.source_key]: 0 }));
    const initial = await store.report(reportQuery());
    assert.equal(sourceRow(initial, oldSource).count, 0);
    assert.equal(sourceRow(initial, oldSource).completeness, 'COMPLETE');
    assert.equal(sourceRow(initial, unread).count, null);
    assert.equal(sourceRow(initial, unread).completeness, 'UNKNOWN');
    const newSource = historySource(1, { whiteboard_id: uuid(9001), op_id: uuid(9002), source_name: 'Replacement source identity' });
    await store.commit(capture([newSource, unread], { [newSource.source_key]: 9 }, { asOf: '2026-11-11T21:15:00Z' }));
    const catalog = await store.sources(true);
    assert.ok(catalog.some(source => source.source_key === oldSource.source_key && source.current === false));
    assert.ok(catalog.some(source => source.source_key === newSource.source_key && source.current === true));
    const archived = await store.report(reportQuery({ source_key: oldSource.source_key }));
    assert.equal(sourceRow(archived, oldSource).count, 0);
    const unproven = sourceRow(await store.report(reportQuery({ source_key: newSource.source_key })), newSource);
    assert.equal(unproven.count, null);
    assert.equal(unproven.completeness, 'REVIEW');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.dana_dsf_history_hour_v1 WHERE source_key=$1', [newSource.source_key])).rows[0].n, 0);
  });
});

test('PostgreSQL department-only identity changes cannot relabel old or transition-hour counts', integration, async () => {
  let before, after, later;
  const nextHour = '2026-11-11T22:00:00.000000Z';
  await withDsf(async ({ client, adapter }) => {
    const source = await seedSource(client, 1, 'Machine with a department move', 'CUTTER GRIND');
    await seedShift(client, source, 501, HOUR, '2026-11-12T04:00:00Z');
    await seedEvent(client, source, 1, '2026-11-11T20:30:00Z', 7);
    await seedEvent(client, source, 2, '2026-11-11T21:10:00Z', 3);
    await seedEvent(client, source, 3, '2026-11-11T22:30:00Z', 4);
    before = await collect(adapter);
    await client.query('INSERT INTO pg_temp.tbl_department (id,name) VALUES ($1,$2)', [uuid(9005), 'Hard Turn (Pinions)']);
    await client.query('UPDATE pg_temp.tbl_line SET department_id=$1 WHERE id=$2', [uuid(9005), source.line_id]);
    after = await collect(adapter, [HOUR, END], '2026-11-11T21:15:00Z');
    later = await modules().collectDsfHistory(adapter, '2026-11-11T23:00:00Z', {
      system_key: SYSTEM, backfill_start: HOUR, backfill_hour: END, hours: [END, nextHour],
    });
    assert.equal(before.sources[0].mapping_id, after.sources[0].mapping_id);
    assert.equal(before.sources[0].whiteboard_id, after.sources[0].whiteboard_id);
    assert.equal(before.sources[0].op_id, after.sources[0].op_id);
    assert.equal(before.sources[0].line_id, after.sources[0].line_id);
    assert.notEqual(before.sources[0].source_key, after.sources[0].source_key);
    assert.equal(after.hours.find(hour => hour.hour_start === HOUR).count, 7, 'The source query alone cannot determine the historical department cutover.');
  });
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    const oldSource = before.sources[0], newSource = after.sources[0];
    await store.commit(before);
    await store.commit(after);
    const report = await store.report(reportQuery());
    assert.equal(sourceRow(report, oldSource).count, 7);
    assert.equal(sourceRow(report, oldSource).completeness, 'COMPLETE');
    assert.equal(sourceRow(report, newSource).count, null);
    assert.equal(sourceRow(report, newSource).completeness, 'REVIEW');
    const transition = report.rows.find(row => row.source_key === newSource.source_key && Date.parse(row.period_start) === Date.parse(END));
    assert.equal(transition.count, null);
    assert.equal(transition.completeness, 'REVIEW');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.dana_dsf_history_hour_v1 WHERE source_key=$1', [newSource.source_key])).rows[0].n, 0);
    const issues = (await client.query('SELECT code FROM public.dana_dsf_history_issue_v1 WHERE source_key=$1 ORDER BY hour_start', [newSource.source_key])).rows;
    assert.deepEqual(issues, [{ code: 'HISTORY_IDENTITY_CHANGE_WINDOW' }, { code: 'HISTORY_IDENTITY_CHANGE_WINDOW' }]);
    await store.commit(later);
    const final = await store.report(reportQuery());
    const future = final.rows.find(row => row.source_key === newSource.source_key && Date.parse(row.period_start) === Date.parse(nextHour));
    assert.equal(future.count, 4);
    assert.equal(future.completeness, 'COMPLETE');
    assert.equal(sourceRow(final, oldSource).count, 7);
    assert.equal(sourceRow(final, newSource).count, null);
    assert.equal(final.totals.known_subtotal, 11, 'Old seven plus future four must not be doubled under the new source identity.');
    const identity = (await client.query('SELECT first_seen_at FROM public.dana_dsf_history_source_v1 WHERE source_key=$1', [newSource.source_key])).rows[0];
    assert.equal(identity.first_seen_at.toISOString(), '2026-11-11T21:15:00.000Z');
  });
});

test('PostgreSQL reactivating an old identity cannot overwrite the intervening identity history', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    const original = historySource(1);
    const moved = historySource(1, { department_id: uuid(9005), department_name: 'Hard Turn (Pinions)' });
    await store.commit(capture([original], { [original.source_key]: 7 }));
    await store.commit(capture([moved], { [moved.source_key]: 70 }, { asOf: '2026-11-11T21:15:00Z' }));
    await store.commit(capture([moved], { [moved.source_key]: 4 }, {
      hour: '2026-11-11T22:00:00Z', end: '2026-11-11T23:00:00Z', asOf: '2026-11-11T23:00:00Z',
    }));
    const returning = capture([original], { [original.source_key]: 40 }, {
      hour: '2026-11-11T22:00:00Z', end: '2026-11-11T23:00:00Z', asOf: '2026-11-11T23:15:00Z',
    });
    returning.hours.push(capture([original], { [original.source_key]: 99 }, { asOf: '2026-11-11T23:15:00Z' }).hours[0]);
    await store.commit(returning);
    const stored = (await client.query('SELECT source_key,hour_start,count::text AS count FROM public.dana_dsf_history_hour_v1 ORDER BY hour_start')).rows;
    assert.deepEqual(stored.map(row => [row.source_key, row.count]), [[original.source_key, '7'], [moved.source_key, '4']]);
    const rejected = (await client.query('SELECT code FROM public.dana_dsf_history_issue_v1 WHERE source_key=$1 AND hour_start=$2', [original.source_key, '2026-11-11T22:00:00Z'])).rows;
    assert.deepEqual(rejected, [{ code: 'HISTORY_IDENTITY_CHANGE_WINDOW' }]);
    await store.commit(capture([original], { [original.source_key]: 5 }, {
      hour: '2026-11-12T00:00:00Z', end: '2026-11-12T01:00:00Z', asOf: '2026-11-12T01:00:00Z',
    }));
    const validFuture = (await client.query('SELECT count::text AS count FROM public.dana_dsf_history_hour_v1 WHERE source_key=$1 AND hour_start=$2', [original.source_key, '2026-11-12T00:00:00Z'])).rows;
    assert.deepEqual(validFuture, [{ count: '5' }]);
    const identity = (await client.query('SELECT first_seen_at,current_since FROM public.dana_dsf_history_source_v1 WHERE source_key=$1', [original.source_key])).rows[0];
    assert.equal(identity.first_seen_at.toISOString(), '2026-11-11T21:00:00.000Z');
    assert.equal(identity.current_since.toISOString(), '2026-11-11T23:15:00.000Z');
    assert.equal((await client.query('SELECT count::text AS count FROM public.dana_dsf_history_hour_v1 WHERE source_key=$1', [moved.source_key])).rows[0].count, '4');
  });
});

test('PostgreSQL history retains ambiguous source counts but excludes them from production totals', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const { DsfHistoryStore } = modules();
    const store = new DsfHistoryStore(database);
    await store.ensure();
    const first = historySource(1, { duplicate_operation: true, review_reason: 'DUPLICATE_OPERATION' });
    const second = historySource(2, { op_id: first.op_id, line_id: first.line_id, duplicate_operation: true, review_reason: 'DUPLICATE_OPERATION' });
    await store.commit(capture([first, second], { [first.source_key]: 3, [second.source_key]: 5 }));
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.dana_dsf_history_hour_v1')).rows[0].n, 2);
    const report = await store.report(reportQuery());
    assert.equal(report.totals.known_subtotal, 0);
    assert.equal(report.totals.excluded_duplicate_sources, 2);
    assert.equal(sourceRow(report, first).completeness, 'REVIEW');
    assert.equal(sourceRow(report, second).completeness, 'REVIEW');
  });
});

test('PostgreSQL history machine aliases require matching approval and exclude Lapper profiles without changing source counts', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    const source = historySource(1);
    await store.commit(capture([source], { [source.source_key]: 7 }));
    const departmentId = uuid(7001), machineId = uuid(7002), unrelatedMachineId = uuid(7003);
    await client.query('INSERT INTO public.departments (id,code,"deletedAt") VALUES ($1,$2,NULL)', [departmentId, '45']);
    await client.query('INSERT INTO public.machines (id,machine_number,department_id,"deletedAt") VALUES ($1,$2,$3,NULL),($4,$5,$3,NULL)',
      [machineId, 'CG-FIXTURE-1', departmentId, unrelatedMachineId, 'OTHER-FIXTURE']);
    await client.query(`INSERT INTO public.dana_dsf_machine_mapping_v1
      (machine_id,mapping_id,whiteboard_id,op_id,line_id,department_id,source_department,line_name,whiteboard_name,enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [machineId, source.mapping_id, source.whiteboard_id, source.op_id, source.line_id, source.department_id,
        '45', source.line_name, source.source_name]);
    const linked = (await store.sources(true)).find(row => row.source_key === source.source_key);
    assert.equal(linked.machine_id, machineId);
    assert.equal(linked.machine_number, 'CG-FIXTURE-1');
    assert.equal(sourceRow(await store.report(reportQuery()), source).machine_number, 'CG-FIXTURE-1');
    const physicalBefore = (await client.query('SELECT * FROM public.machines ORDER BY id')).rows;

    for (const [lineName, whiteboardName] of [['Changed line identity', source.source_name], [source.line_name, 'Changed whiteboard identity']]) {
      await client.query('UPDATE public.dana_dsf_machine_mapping_v1 SET line_name=$1,whiteboard_name=$2 WHERE machine_id=$3',
        [lineName, whiteboardName, machineId]);
      const unlinked = (await store.sources(true)).find(row => row.source_key === source.source_key);
      assert.equal(unlinked.machine_id, null);
      assert.equal(unlinked.machine_number, null);
      const report = sourceRow(await store.report(reportQuery()), source);
      assert.equal(report.machine_number, null);
      assert.equal(report.count, 7);
      assert.equal(report.completeness, 'COMPLETE');
    }

    await client.query('UPDATE public.dana_dsf_machine_mapping_v1 SET line_name=$1,whiteboard_name=$2 WHERE machine_id=$3',
      [source.line_name, source.source_name, machineId]);
    await client.query('CREATE SCHEMA lapper; CREATE TABLE lapper.machines (id uuid PRIMARY KEY,public_machine_id uuid NOT NULL)');
    await client.query('INSERT INTO lapper.machines VALUES ($1,$2)', [uuid(8001), unrelatedMachineId]);
    assert.equal((await store.sources(true)).find(row => row.source_key === source.source_key).machine_id, machineId,
      'An unrelated Lapper profile must not suppress this physical alias.');
    await client.query('INSERT INTO lapper.machines VALUES ($1,$2)', [uuid(8002), machineId]);
    const profiled = (await store.sources(true)).find(row => row.source_key === source.source_key);
    assert.equal(profiled.machine_id, null);
    assert.equal(profiled.machine_number, null);
    const report = await store.report(reportQuery());
    const row = sourceRow(report, source);
    assert.equal(row.machine_number, null);
    assert.equal(row.count, 7);
    assert.equal(row.completeness, 'COMPLETE');
    assert.equal(report.totals.known_subtotal, 7);
    assert.deepEqual((await client.query('SELECT count::text AS count FROM public.dana_dsf_history_hour_v1')).rows, [{ count: '7' }]);
    assert.deepEqual((await client.query('SELECT * FROM public.machines ORDER BY id')).rows, physicalBefore);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.cutter_machine_runs')).rows[0].n, 0);
  });
});

test('PostgreSQL history retains the prior known count while scoped issues remain reviewable and retryable', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const { DsfHistoryStore } = modules();
    const store = new DsfHistoryStore(database);
    await store.ensure();
    const source = historySource(1);
    await store.commit(capture([source], { [source.source_key]: 7 }));
    await store.commit(capture([source], { [source.source_key]: 0 }, {
      hour: END, end: '2026-11-11T22:00:00.000000Z',
      asOf: '2026-11-11T22:01:00.000000Z', nextBackfill: '2026-11-11T22:00:00.000000Z',
      issues: [{ source_key: source.source_key, hour_start: HOUR, code: 'HISTORY_UNRESOLVED_REASON' }],
    }));
    const stored = await client.query('SELECT count::text AS count FROM public.dana_dsf_history_hour_v1 WHERE hour_start=$1', [HOUR]);
    assert.equal(stored.rows[0].count, '7');
    const row = sourceRow(await store.report(reportQuery()), source);
    assert.equal(row.completeness, 'REVIEW');
    assert.notEqual(row.count, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.dana_dsf_history_issue_v1')).rows[0].n, 1);
    const state = (await client.query('SELECT next_backfill_hour FROM public.dana_dsf_history_state_v1')).rows[0];
    assert.equal(state.next_backfill_hour.toISOString(), '2026-11-11T22:00:00.000Z');
    await store.commit(capture([source], { [source.source_key]: 3 }, { asOf: '2026-11-11T22:02:00.000000Z', nextBackfill: '2026-11-11T22:00:00.000000Z' }));
    assert.equal(sourceRow(await store.report(reportQuery()), source).count, 3);
    assert.equal(sourceRow(await store.report(reportQuery()), source).completeness, 'COMPLETE');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.dana_dsf_history_issue_v1')).rows[0].n, 0);
  });
});

test('PostgreSQL history clears a recovered global issue while preserving the remaining scoped source issue', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    const bad = historySource(1), good = historySource(2);
    const sources = [bad, good];
    await store.commit(capture(sources, { [bad.source_key]: 7, [good.source_key]: 4 }));
    await store.commit(capture(sources, {}, { asOf: '2026-11-11T21:01:00Z', nextBackfill: HOUR,
      issues: [{ source_key: null, hour_start: HOUR, code: 'HISTORY_EVENT_LIMIT' }] }));
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public.dana_dsf_history_issue_v1 WHERE source_key=''")).rows[0].n, 1);
    await store.commit(capture(sources, { [good.source_key]: 4 }, { asOf: '2026-11-11T21:02:00Z', nextBackfill: END,
      issues: [{ source_key: bad.source_key, hour_start: HOUR, code: 'HISTORY_UNRESOLVED_REASON' }] }));
    const remaining = (await client.query('SELECT source_key,code FROM public.dana_dsf_history_issue_v1')).rows;
    assert.deepEqual(remaining, [{ source_key: bad.source_key, code: 'HISTORY_UNRESOLVED_REASON' }]);
    const report = await store.report(reportQuery());
    assert.equal(sourceRow(report, bad).completeness, 'REVIEW');
    assert.equal(sourceRow(report, good).completeness, 'COMPLETE');
    assert.equal(sourceRow(report, good).count, 4);
  });
});

test('PostgreSQL shift reports flag mixed historical boundaries until affected hours are reread', integration, async () => {
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    const source = historySource(1);
    const first = capture([source], { [source.source_key]: 3 }, { asOf: '2026-11-11T22:01:00Z' });
    first.hours[0].slices[0].shift_end = '2026-11-11T22:00:00Z';
    await store.commit(first);
    const second = capture([source], { [source.source_key]: 4 }, { hour: END, end: '2026-11-11T22:00:00Z', asOf: '2026-11-11T22:02:00Z', nextBackfill: '2026-11-11T22:00:00Z' });
    second.hours[0].last_production_at = '2026-11-11T21:30:00Z';
    second.hours[0].slices[0].shift_end = '2026-11-11T22:00:00Z';
    await store.commit(second);
    const revised = capture([source], { [source.source_key]: 3 }, { asOf: '2026-11-11T22:31:00Z', nextBackfill: '2026-11-11T22:00:00Z' });
    revised.hours[0].slices[0].shift_end = '2026-11-11T22:30:00Z';
    await store.commit(revised);
    const report = await store.report(reportQuery({ group: 'shift' }));
    const shifts = report.rows.filter(row => row.shift_id === '501');
    assert.equal(shifts.length, 2);
    assert.ok(shifts.every(row => row.completeness === 'REVIEW' && row.review_reason === 'SHIFT_BOUNDARY_CHANGED'));
    assert.equal(report.totals.count, null);
    second.source_as_of = '2026-11-11T22:32:00Z';
    second.hours[0].slices[0].shift_end = '2026-11-11T22:30:00Z';
    await store.commit(second);
    const repaired = (await store.report(reportQuery({ group: 'shift' }))).rows.filter(row => row.shift_id === '501');
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].review_reason, null);
    assert.equal(repaired[0].completeness, 'PARTIAL');
    assert.equal(repaired[0].count, 7);
  });
});

async function collect(adapter, hours = [HOUR], at = END) {
  return modules().collectDsfHistory(adapter, at, {
    system_key: SYSTEM, backfill_start: hours[0], backfill_hour: hours[0], hours,
  });
}

async function seedShift(client, source, id, start, end, number = 2) {
  await client.query('INSERT INTO pg_temp.tbl_shift (id,line_id,shift,start_of_day,start_time,end_time,timestamp) VALUES ($1,$2,$3,false,$4,$5,$4)', [id, source.line_id, number, start, end]);
}

test('PostgreSQL collector inventories all five grinders and named areas and counts RUN only', integration, async () => {
  await withDsf(async ({ client, adapter }) => {
    const sources = [];
    for (const [index, name] of ['CutGrind 6', 'CutGrind 4', 'CutGrind 3', 'CutGrind 7', 'CutGrind 5'].entries()) {
      sources.push(await seedSource(client, index + 1, name, 'CUTTER GRIND'));
    }
    sources.push(await seedSource(client, 6, 'Named pinions', 'Hard Turn (Pinions)'));
    const duplicate = await seedSource(client, 7, 'PIN550', 'Dept. 132');
    sources.push(duplicate);
    sources.push(await seedSource(client, 8, 'PIN551', 'Dept. 132', { op_id: duplicate.op_id, line_id: duplicate.line_id, department_id: duplicate.department_id }));
    for (const source of sources) {
      const n = Number(source.mapping_id.slice(-12));
      if (source.mapping_id !== sources.at(-1).mapping_id) await seedShift(client, source, n, HOUR, '2026-11-12T04:00:00Z');
      await seedEvent(client, source, n, '2026-11-11T20:01:00Z', 2);
    }
    // Slow Running has running=true too, and loss rows may have part_count.
    await client.query('INSERT INTO pg_temp.tbl_op_state_reason (id,op_id,code,name,running,active) VALUES (999,$1,10000,$2,true,true)', [sources[0].op_id, 'Slow Running']);
    await seedEvent(client, sources[0], 100, '2026-11-11T20:01:00Z', 99, 999);
    await seedEvent(client, sources[0], 101, END, 500);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL jit=off');
    const captured = await collect(adapter);
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
    await client.query('ROLLBACK');
    assert.equal(captured.sources.length, 8);
    assert.equal(captured.sources.filter(source => source.source_name.startsWith('CutGrind')).length, 5);
    assert.ok(captured.sources.some(source => source.department_name === 'Hard Turn (Pinions)'));
    assert.equal(captured.hours.length, 8);
    assert.ok(captured.hours.every(hour => hour.count === 2));
    assert.equal(captured.sources.filter(source => source.duplicate_operation).length, 2);
    assert.equal(captured.issues.length, 0);
  });
});

test('PostgreSQL collector preserves exact sub-hour shift allocation and microsecond event boundaries', integration, async () => {
  await withDsf(async ({ client, adapter }) => {
    const source = await seedSource(client, 1);
    await seedShift(client, source, 1, HOUR, '2026-11-11T20:29:59Z', 1);
    await seedShift(client, source, 2, '2026-11-11T20:30:00Z', END, 2);
    await seedEvent(client, source, 1, '2026-11-11T20:29:59.999900Z', 2);
    await seedEvent(client, source, 2, '2026-11-11T20:30:00.000000Z', 3);
    await seedEvent(client, source, 3, '2026-11-11T20:59:59.999900Z', 4);
    await seedEvent(client, source, 4, END, 500);
    const captured = await collect(adapter);
    assert.equal(captured.hours.length, 1);
    assert.equal(captured.hours[0].count, 9);
    assert.deepEqual(captured.hours[0].slices.map(slice => [slice.shift_id, slice.count]), [['1', 2], ['2', 7]]);
    assert.equal(captured.hours[0].slices[0].slice_end, '2026-11-11T20:30:00.000000Z');
    assert.equal(captured.hours[0].last_production_at, '2026-11-11T20:59:59.999900Z');
  });
});

test('PostgreSQL collector retains both repeated local hours across Indianapolis DST fall-back', integration, async () => {
  await withDsf(async ({ client, adapter }) => {
    const source = await seedSource(client, 1);
    await seedShift(client, source, 1, '2026-11-01T04:00:00Z', '2026-11-01T12:00:00Z');
    await seedEvent(client, source, 1, '2026-11-01T05:30:00Z', 2);
    await seedEvent(client, source, 2, '2026-11-01T06:30:00Z', 3);
    const hours = ['2026-11-01T05:00:00.000000Z', '2026-11-01T06:00:00.000000Z'];
    const captured = await collect(adapter, hours, '2026-11-01T07:00:00Z');
    assert.deepEqual(captured.hours.map(hour => [hour.hour_start, hour.count]), [[hours[0], 2], [hours[1], 3]]);
    const sameLabel = captured.hours.map(hour => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis', hour: '2-digit', hour12: false }).format(new Date(hour.hour_start)));
    assert.deepEqual(sameLabel, ['01', '01']);
    assert.notEqual(captured.hours[0].hour_start, captured.hours[1].hour_start);
  });
});

test('PostgreSQL collector isolates invalid source evidence and preserves healthy and verified-zero windows', integration, async () => {
  await withDsf(async ({ client, adapter }) => {
    const good = await seedSource(client, 1, 'Valid machine');
    const bad = await seedSource(client, 2, 'Wrong reason owner');
    const zero = await seedSource(client, 3, 'Verified zero');
    const wrongBoard = await seedSource(client, 4, 'Wrong board identity');
    const negative = await seedSource(client, 5, 'Invalid negative parts');
    for (const [index, source] of [good, bad, zero, wrongBoard, negative].entries()) await seedShift(client, source, index + 1, HOUR, END);
    await seedEvent(client, good, 1, '2026-11-11T20:01:00Z', 4);
    await seedEvent(client, bad, 2, '2026-11-11T20:02:00Z', 7, 10001);
    await seedEvent(client, wrongBoard, 3, '2026-11-11T20:03:00Z', 1, 10004, good.whiteboard_id);
    await seedEvent(client, negative, 4, '2026-11-11T20:04:00Z', -1);
    const captured = await collect(adapter);
    const byMapping = new Map(captured.sources.map(source => [source.mapping_id, source.source_key]));
    assert.equal(captured.hours.find(hour => hour.source_key === byMapping.get(good.mapping_id)).count, 4);
    assert.equal(captured.hours.find(hour => hour.source_key === byMapping.get(zero.mapping_id)).count, 0);
    assert.ok(!captured.hours.some(hour => hour.source_key === byMapping.get(bad.mapping_id)));
    assert.ok(captured.issues.some(issue => issue.source_key === byMapping.get(bad.mapping_id) && issue.code === 'HISTORY_UNRESOLVED_REASON'));
    assert.ok(captured.issues.some(issue => issue.source_key === byMapping.get(wrongBoard.mapping_id) && issue.code === 'HISTORY_WHITEBOARD_MISMATCH'));
    assert.ok(captured.issues.some(issue => issue.source_key === byMapping.get(negative.mapping_id) && issue.code === 'HISTORY_INVALID_PART_COUNT'));
    assert.equal(captured.next_backfill_hour, END, 'A scoped issue records a gap without pinning every healthy source to one scan hour.');
  });
});

test('PostgreSQL collector exposes the global event sentinel without advancing or inventing zero hours', integration, async () => {
  await withDsf(async ({ client, adapter }) => {
    const source = await seedSource(client, 1);
    await seedShift(client, source, 1, HOUR, END);
    await client.query(`INSERT INTO pg_temp.tbl_whiteboard_cycles_master (id,whiteboard_id,machine_id,code,length,timestamp,part_count)
      SELECT n,$1,$2,10001,1,$3::timestamptz + (n % 3600) * interval '1 second',1
      FROM generate_series(1,200001) n`, [source.whiteboard_id, source.mapping_id, HOUR]);
    await client.query('SET jit=off');
    const captured = await collect(adapter);
    assert.deepEqual(captured.hours, []);
    assert.ok(captured.issues.some(issue => issue.source_key === null && issue.code === 'HISTORY_EVENT_LIMIT'));
    assert.equal(captured.next_backfill_hour, HOUR);
  });
});

test('PostgreSQL captured sub-hour shifts survive local persistence with exact separate shift totals', integration, async () => {
  let captured;
  await withDsf(async ({ client, adapter }) => {
    const source = await seedSource(client, 1);
    await seedShift(client, source, 1, HOUR, '2026-11-11T20:29:59Z', 1);
    await seedShift(client, source, 2, '2026-11-11T20:30:00Z', END, 2);
    await seedEvent(client, source, 1, '2026-11-11T20:29:59.999900Z', 2);
    await seedEvent(client, source, 2, '2026-11-11T20:30:00Z', 3);
    await seedEvent(client, source, 3, '2026-11-11T20:59:59.999900Z', 4);
    captured = await collect(adapter);
  }); // DSF session is closed before any application-side write.
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    await store.commit(captured);
    const hourly = await store.report(reportQuery());
    assert.equal(sourceRow(hourly, captured.sources[0]).count, 9);
    const shifts = (await store.report(reportQuery({ group: 'shift' }))).rows.filter(row => row.shift_id !== null);
    assert.deepEqual(shifts.map(row => [row.shift_id, row.count, row.completeness]), [['1', 2, 'COMPLETE'], ['2', 7, 'COMPLETE']]);
    assert.equal(shifts[0].period_end, shifts[1].period_start);
  });
});

test('PostgreSQL persisted DST history keeps 25 hourly periods and honest partial-day coverage', integration, async () => {
  let captured;
  await withDsf(async ({ client, adapter }) => {
    const source = await seedSource(client, 1);
    await seedShift(client, source, 1, '2026-11-01T04:00:00Z', '2026-11-01T12:00:00Z');
    await seedEvent(client, source, 1, '2026-11-01T05:30:00Z', 2);
    await seedEvent(client, source, 2, '2026-11-01T06:30:00Z', 3);
    captured = await collect(adapter, ['2026-11-01T05:00:00.000000Z', '2026-11-01T06:00:00.000000Z'], '2026-11-01T07:00:00Z');
  });
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    await store.commit(captured);
    const query = reportQuery({ from: '2026-11-01', to: '2026-11-01' });
    const report = await store.report(query);
    assert.equal(report.rows.length, 25);
    const known = report.rows.filter(row => row.count !== null);
    assert.deepEqual(known.map(row => row.count), [2, 3]);
    assert.notEqual(known[0].period_start, known[1].period_start);
    const daily = (await store.report({ ...query, group: 'day' })).rows[0];
    assert.equal(daily.expected_seconds, 25 * 3600);
    assert.equal(daily.covered_seconds, 2 * 3600);
    assert.equal(daily.count, null);
    assert.equal(daily.completeness, 'UNKNOWN');
    const spring = await store.report({ ...query, from: '2026-03-08', to: '2026-03-08' });
    assert.equal(spring.rows.length, 23);
    assert.ok(spring.rows.every(row => row.count === null && row.completeness === 'UNKNOWN'));
    const springDay = (await store.report({ ...query, from: '2026-03-08', to: '2026-03-08', group: 'day' })).rows[0];
    assert.equal(springDay.expected_seconds, 23 * 3600);
  });
});

test('PostgreSQL persisted cross-midnight shift is complete under its actual local start date', integration, async () => {
  const captures = [];
  const shiftStart = '2026-11-12T04:00:00.000000Z'; // 23:00 on November 11 in Indianapolis.
  const shiftEnd = '2026-11-12T12:00:00.000000Z'; // 07:00 on November 12.
  await withDsf(async ({ client, adapter }) => {
    const source = await seedSource(client, 1);
    await seedShift(client, source, 501, shiftStart, shiftEnd, 3);
    for (let hour = 4; hour < 12; hour++) {
      await seedEvent(client, source, hour, `2026-11-12T${String(hour).padStart(2, '0')}:30:00Z`, 1);
    }
    for (let hour = 4; hour < 12; hour++) {
      const start = `2026-11-12T${String(hour).padStart(2, '0')}:00:00.000000Z`;
      captures.push(await modules().collectDsfHistory(adapter, shiftEnd, {
        system_key: SYSTEM, backfill_start: shiftStart, backfill_hour: start, hours: [start],
      }));
    }
  });
  await withDatabase(async ({ database, client }) => {
    await seedMeshForge(client);
    const store = new (modules().DsfHistoryStore)(database);
    await store.ensure();
    for (const captured of captures) await store.commit(captured);
    const report = await store.report(reportQuery({ group: 'shift' }));
    const shifts = report.rows.filter(row => row.shift_id === '501');
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0].shift_date, '2026-11-11');
    assert.equal(shifts[0].period_start, shiftStart);
    assert.equal(shifts[0].period_end, shiftEnd);
    assert.equal(shifts[0].count, 8);
    assert.equal(shifts[0].covered_seconds, 8 * 3600);
    assert.equal(shifts[0].expected_seconds, 8 * 3600);
    assert.equal(shifts[0].completeness, 'COMPLETE');
  });
});
