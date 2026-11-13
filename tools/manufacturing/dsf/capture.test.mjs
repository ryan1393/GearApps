import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { buildCaptureSql, buildPowerShell, DEFAULT_SOURCES, DEFAULT_WINDOW } from './generate-capture.mjs';

// Types come from the sanitized DSF schema reference, not uploaded production rows.
// Integration tests create only TEMP objects on one session and never read public data.
const COLUMNS = {
  operation_detail: 'operation_id uuid, operation_name text, line_segment_id uuid, line_segment_name text, line_id uuid, line_name text, department_id uuid, department_name text, area_id uuid, area_name text, plant_id uuid, plant_name text, downtime_upper double precision, downtime_lower double precision, ftt_upper double precision, ftt_lower double precision, oee_upper double precision, oee_lower double precision',
  tbl_department: 'id uuid, name text',
  tbl_line: 'id uuid, name text, display_name text, loc_id uuid, area_id uuid, department_id uuid, cell_id uuid, line_type_id uuid, asset_number text, timestamp timestamptz(4), has_multiple_parts boolean, is_emaint_enabled boolean',
  tbl_op: 'id uuid, name text, display_name text, line_id uuid, asset_number text, timestamp timestamptz(4)',
  tbl_whiteboard: 'id uuid, name text, whiteboard_order integer, active boolean, timestamp timestamptz(4), shopfloor_by_shift boolean',
  tbl_whiteboard_machines: 'id uuid, whiteboard_id uuid, op_id uuid, line_id uuid, active boolean',
  tbl_whiteboard_cycles_master: 'id integer, whiteboard_id uuid, machine_id uuid, code integer, length integer, timestamp timestamptz(4), part_count integer',
  tbl_op_state_reason: 'id integer, op_id uuid, code integer, name text, color text, active boolean, running boolean, fttloss boolean, downtime boolean, timestamp timestamptz(4), category_id integer',
  tbl_op_state_category: 'id integer, name text, display_name text',
  tbl_line_state_reason: 'id integer, line_id uuid, code integer, name text, color text, active boolean, timestamp timestamptz(4)',
  tbl_op_state: 'id integer, op_id uuid, code integer, length integer, timestamp timestamptz(4)',
  tbl_line_state: 'id integer, line_id uuid, code integer, length integer, timestamp timestamptz(4)',
  tbl_op_rated_speed: 'id integer, op_id uuid, rated_speed integer, timestamp timestamptz(4), part_count integer',
  tbl_line_rated_speed: 'id integer, line_id uuid, rated_speed integer, timestamp timestamptz(4)',
  tbl_op_cycle_time: 'id integer, op_id uuid, cycle_time integer, rated_speed integer, timestamp timestamptz(4)',
  tbl_line_cycle_time: 'id integer, line_id uuid, cycle_time integer, rated_speed integer, timestamp timestamptz(4)',
  tbl_op_cycle_bounds: 'id integer, op_id uuid, cycle_start timestamptz(4), cycle_end timestamptz(4), serial varchar, part varchar',
  tbl_op_count_target: 'id integer, op_id uuid, count integer, timestamp timestamptz(4)',
  tbl_line_count_target: 'id integer, line_id uuid, count integer, timestamp timestamptz(4)',
  tbl_line_daily_target: 'id integer, line_name text, target integer, timestamp timestamptz(4)',
  tbl_op_count_rework: 'id integer, op_id uuid, count integer, reason integer, length integer, timestamp timestamptz(4)',
  tbl_line_count_rework: 'id integer, line_id uuid, count integer, reason integer, length integer, timestamp timestamptz(4)',
  tbl_op_oee: 'id integer, op_id uuid, oee double precision, oee_availability double precision, oee_performance double precision, oee_quality double precision, timestamp timestamptz(4)',
  tbl_line_oee: 'id integer, line_id uuid, oee double precision, oee_availability double precision, oee_performance double precision, oee_quality double precision, timestamp timestamptz(4)',
  tbl_shift: 'id integer, line_id uuid, shift integer, start_of_day boolean, start_time timestamptz(4), end_time timestamptz(4), timestamp timestamptz(4)',
  tbl_shift_schedule: 'id integer, line_id uuid, shift integer, start_of_day boolean, start_time text, end_time text, timestamp timestamptz(4)',
  tbl_whiteboard_comment_shift: 'id integer, whiteboard_id uuid, shift_id integer, comment text, timestamp timestamptz, user_ip text, user_hostname text, is_deleted boolean, modified_on timestamptz, edited_comment_id integer',
  tbl_whiteboard_daily_aggregate: 'id integer, whiteboard_id uuid, actual integer, target integer, rework integer, code integer, length integer, timestamp date',
  vw_oa_state_data: 'id integer, op_id uuid, line_id uuid, length integer, timestamp timestamptz(4), reason_id integer, code integer, faultreason text, active boolean',
};

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const SOURCE = { name: 'Fixture OP10', sourceId: uuid(1), opId: uuid(2), lineId: uuid(3) };
const EMPTY_SOURCE = { name: 'Fixture Empty', sourceId: uuid(11), opId: uuid(12), lineId: uuid(13) };
const WINDOW = {
  start: '2026-11-11T20:00:00Z',
  end: '2026-11-12T04:00:00Z',
  cutoff: '2026-11-12T02:00:00Z',
  timezone: 'America/Indiana/Indianapolis',
};
const OPTIONS = { sources: [SOURCE, EMPTY_SOURCE], window: WINDOW };
const PRIVATE_MARKERS = ['PRIVATE_SERIAL_SENTINEL', 'PRIVATE_HOST_SENTINEL', 'PRIVATE_COMMENT_SENTINEL', 'PRIVATE_CONFIG_SENTINEL', '198.51.100.73'];
const pgUrl = process.env.DSF_CAPTURE_TEST_DATABASE_URL;

async function insert(client, table, values) {
  assert.ok(Object.hasOwn(COLUMNS, table), `unknown fixture table ${table}`);
  const columns = Object.keys(values);
  assert.ok(columns.every(column => /^[a-z_]+$/.test(column)));
  await client.query(`INSERT INTO pg_temp.${table} (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(values));
}

async function sourceFixture(client, source, boardId, departmentId, departmentName) {
  await insert(client, 'tbl_department', { id: departmentId, name: departmentName });
  await insert(client, 'tbl_line', { id: source.lineId, name: `Line ${source.name}`, display_name: source.name, department_id: departmentId, asset_number: `Asset ${source.name}`, has_multiple_parts: false, is_emaint_enabled: false });
  await insert(client, 'tbl_op', { id: source.opId, line_id: source.lineId, name: 'OP10', display_name: source.name });
  await insert(client, 'tbl_whiteboard', { id: boardId, name: source.name, active: true, shopfloor_by_shift: true });
  await insert(client, 'tbl_whiteboard_machines', { id: source.sourceId, whiteboard_id: boardId, op_id: source.opId, line_id: source.lineId, active: true });
}

async function fixtures(client) {
  for (const [table, columns] of Object.entries(COLUMNS)) {
    await client.query(`CREATE TEMP TABLE ${table} (${columns})`);
  }
  await client.query('CREATE TEMP TABLE tbl_whiteboard_cycles (LIKE pg_temp.tbl_whiteboard_cycles_master); CREATE TEMP TABLE tbl_whiteboard_cycles_current (LIKE pg_temp.tbl_whiteboard_cycles_master); CREATE TEMP TABLE tbl_whiteboard_cycles_old (LIKE pg_temp.tbl_whiteboard_cycles_master)');
  await client.query(`ALTER TABLE pg_temp.tbl_whiteboard ADD hostname text, ADD ip text, ADD comments text; COMMENT ON COLUMN pg_temp.tbl_op.name IS 'SCHEMA_COMMENT_ALLOWED'`);
  await sourceFixture(client, SOURCE, uuid(4), uuid(5), 'Dept. 181');
  await sourceFixture(client, EMPTY_SOURCE, uuid(14), uuid(15), 'Dept. 121');
  await client.query('UPDATE pg_temp.tbl_whiteboard SET hostname=$1,ip=$2,comments=$3', [PRIVATE_MARKERS[1], PRIVATE_MARKERS[4], PRIVATE_MARKERS[2]]);
  await client.query('CREATE TEMP TABLE fixture_config (value text)');
  await client.query('INSERT INTO fixture_config VALUES ($1)', [PRIVATE_MARKERS[3]]);
  const inventory = [
    ['CutGrind 6 1-24-77', 'CUTTER GRIND'], ['CutGrind 4 1-24-78', 'CUTTER GRIND'],
    ['CutGrind 3 1-24-79', 'CUTTER GRIND'], ['CutGrind 7 1-24-80', 'CUTTER GRIND'],
    ['CutGrind 5 1-24-81', 'CUTTER GRIND'], ['Named pinion fixture', 'Hard Turn (Pinions)'],
    ['Named ring fixture', 'Hard Turn (Rings)'], ['Named peen fixture', 'Shot Peen'],
    ['Named straightener fixture', 'Straightener'], ['Named thread fixture', 'Thread Draw'],
  ];
  for (let index = 0; index < inventory.length; index++) {
    const [name, department] = inventory[index];
    const base = 100 + index * 10;
    await sourceFixture(client, { name, sourceId: uuid(base), opId: uuid(base + 1), lineId: uuid(base + 2) }, uuid(base + 3), uuid(base + 4), department);
  }
  await insert(client, 'tbl_op_state_category', { id: 1, name: 'Machine', display_name: 'Machine' });
  await insert(client, 'tbl_op_state_reason', { id: 101, op_id: SOURCE.opId, code: 1, name: 'Running', color: '#06A34A', active: true, running: true, fttloss: false, downtime: false, category_id: 1, timestamp: '2026-01-01T00:00:00Z' });
  await insert(client, 'tbl_shift', { id: 1, line_id: SOURCE.lineId, shift: 2, start_of_day: false, start_time: WINDOW.start, end_time: WINDOW.end, timestamp: WINDOW.start });
  await insert(client, 'tbl_shift', { id: 2, line_id: EMPTY_SOURCE.lineId, shift: 2, start_of_day: false, start_time: WINDOW.start, end_time: WINDOW.end, timestamp: WINDOW.start });
  await insert(client, 'tbl_op_cycle_bounds', { id: 1, op_id: SOURCE.opId, cycle_start: '2026-11-11T20:05:00Z', cycle_end: '2026-11-11T20:06:00Z', serial: PRIVATE_MARKERS[0], part: 'Fixture part' });
  for (const row of [
    { id: 1, whiteboard_id: uuid(4), shift_id: 1, comment: 'Approved fixture report note', is_deleted: false },
    { id: 2, whiteboard_id: uuid(4), shift_id: 1, comment: 'Deleted fixture report note', is_deleted: true, edited_comment_id: 1 },
    { id: 3, whiteboard_id: uuid(14), shift_id: 1, comment: 'OUT_OF_SCOPE_NOTE_SENTINEL', is_deleted: false },
    { id: 4, whiteboard_id: uuid(4), shift_id: 2, comment: 'OUT_OF_SCOPE_NOTE_SENTINEL', is_deleted: false },
  ]) await insert(client, 'tbl_whiteboard_comment_shift', { timestamp: '2026-11-11T21:00:00Z', modified_on: '2026-11-11T22:00:00Z', user_ip: PRIVATE_MARKERS[4], user_hostname: PRIVATE_MARKERS[1], ...row });
}

async function withFixture(run) {
  const client = new pg.Client({ connectionString: pgUrl });
  await client.connect();
  try {
    await fixtures(client);
    const { rows } = await client.query('SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()');
    const schema = rows[0].nspname;
    assert.match(schema, /^pg_temp_\d+$/);
    await run(client, schema);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

async function capture(client, schema, options = OPTIONS) {
  // Execute generated SELECTs and schema guards against TEMP objects. Interpret only
  // the small psql control vocabulary emitted by this generator, not arbitrary psql.
  const script = buildCaptureSql(options).replace(/\bpublic\b/g, schema);
  const records = [];
  const variables = new Map();
  const branches = [];
  const active = () => branches.every(branch => branch.active);
  let pending = [];
  const flush = async (gset = false) => {
    if (!pending.length) return;
    const statement = pending.join('\n');
    pending = [];
    let results;
    try {
      results = await client.query(statement);
    } catch (error) {
      // psql ON_ERROR_STOP returns 3 on an SQL error and retains prior output.
      throw Object.assign(error, { records: [...records], exitCode: 3 });
    }
    const statements = Array.isArray(results) ? results : [results];
    for (const [index, result] of statements.entries()) {
      for (const row of result.rows ?? []) {
        if (gset && index === statements.length - 1) {
          for (const [key, value] of Object.entries(row)) variables.set(key, value);
          continue;
        }
        for (const value of Object.values(row)) {
          if (value && typeof value === 'object') records.push(value);
          else if (typeof value === 'string' && /^[{[]/.test(value)) records.push(JSON.parse(value));
        }
      }
    }
  };
  for (const line of script.split('\n')) {
    if (!line.startsWith('\\')) {
      if (active()) {
        pending.push(line);
        // Generated SQL ends statements on their own final line, as psql does.
        // Execute them individually so an error cannot discard prior manifests.
        if (line.trimEnd().endsWith(';') && !line.trimStart().startsWith('--')) await flush();
      }
      continue;
    }
    const [command, argument] = line.slice(1).split(/\s+/, 2);
    if (command === 'gset') {
      if (active()) await flush(true);
    } else if (command === 'if') {
      await flush();
      assert.match(argument, /^:[a-z_]+$/);
      const parentActive = active();
      const truth = variables.get(argument.slice(1));
      assert.ok(!parentActive || typeof truth === 'boolean', 'schema guard must return a boolean');
      branches.push({ parentActive, truth, active: parentActive && truth });
    } else if (command === 'else') {
      await flush();
      const branch = branches.at(-1);
      assert.ok(branch, 'unmatched psql else');
      branch.active = branch.parentActive && !branch.truth;
    } else if (command === 'endif') {
      await flush();
      assert.ok(branches.pop(), 'unmatched psql endif');
    } else if (command === 'quit') {
      if (active()) {
        await flush();
        throw Object.assign(new Error(`Generated capture aborted with psql exit ${argument}`), { records, exitCode: Number(argument) });
      }
    } else {
      assert.ok(['set', 'pset'].includes(command), `unsupported psql command ${command}`);
    }
  }
  await flush();
  assert.equal(branches.length, 0, 'unclosed psql conditional');
  return records;
}

function dataset(records, name, source = SOURCE) {
  const matches = records.filter(record => record.kind === 'DATASET' && record.dataset === name && (source === null || record.source_id === source.sourceId));
  assert.equal(matches.length, 1, `expected one ${name} manifest for ${source?.name ?? 'global dataset'}`);
  return matches[0];
}

async function event(client, id, timestamp, extra = {}) {
  await insert(client, 'tbl_whiteboard_cycles_master', { id, machine_id: SOURCE.sourceId, whiteboard_id: uuid(4), code: 101, length: 100, part_count: 1, timestamp, ...extra });
}

test('default capture covers the reference line and all five cutter-grind sources', () => {
  assert.equal(DEFAULT_SOURCES.length, 6);
  assert.equal(DEFAULT_SOURCES.filter(source => /cutgrind/i.test(source.name)).length, 5);
  assert.equal(new Set(DEFAULT_SOURCES.map(source => source.sourceId)).size, 6);
  for (const source of DEFAULT_SOURCES) {
    for (const key of ['sourceId', 'opId', 'lineId']) assert.match(source[key], /^[0-9a-f-]{36}$/i);
  }
  assert.ok(Date.parse(DEFAULT_WINDOW.start) < Date.parse(DEFAULT_WINDOW.cutoff));
  assert.ok(Date.parse(DEFAULT_WINDOW.cutoff) < Date.parse(DEFAULT_WINDOW.end));
  assert.equal(DEFAULT_WINDOW.timezone, 'America/Indiana/Indianapolis');
});

test('capture transaction is read-only, completes explicitly and rolls back', () => {
  const sql = buildCaptureSql(OPTIONS);
  assert.match(sql, /\\set\s+ON_ERROR_STOP\s+(?:on|1)/i);
  assert.match(sql, /BEGIN[\s\S]{0,100}READ ONLY/i);
  assert.match(sql, /CAPTURE_COMPLETED/);
  assert.match(sql, /DSF_CAPTURE_COMPLETED_READ_ONLY_V1/);
  assert.match(sql, /business_parity_verified/);
  assert.ok(sql.lastIndexOf('ROLLBACK;') < sql.lastIndexOf("'CAPTURE_COMPLETED'"));
  assert.match(sql, /'transaction_finished','rolled_back'/);
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE\s+|COMMIT\s*;|COPY\s+|CREATE\s+(?:TEMP\s+)?TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i);
  for (const privateValue of PRIVATE_MARKERS) assert.ok(!sql.includes(privateValue));
  assert.ok(buildPowerShell(OPTIONS).includes(sql), 'PowerShell must embed the same capture SQL');
});

test('checked-in SQL and PowerShell are regenerated from one definition', () => {
  assert.equal(readFileSync(new URL('./DSF-capture.sql', import.meta.url), 'utf8'), buildCaptureSql());
  assert.equal(readFileSync(new URL('./DSF-capture.ps1', import.meta.url), 'utf8'), buildPowerShell());
});

test('invalid selectors and windows fail before producing a runnable capture', () => {
  for (const options of [
    { ...OPTIONS, sources: [] },
    { ...OPTIONS, sources: [{ ...SOURCE, sourceId: "not-a-uuid'; SELECT 1; --" }] },
    { ...OPTIONS, window: { ...WINDOW, start: 'invalid-date' } },
    { ...OPTIONS, window: { ...WINDOW, end: WINDOW.start } },
    { ...OPTIONS, window: { ...WINDOW, cutoff: '2026-11-13T00:00:00Z' } },
    { ...OPTIONS, rowLimit: 0 },
  ]) assert.throws(() => buildCaptureSql(options));
});

test('PostgreSQL: all supported datasets execute with empty manifests, safe projections and whole-plant inventory', { skip: !pgUrl }, async () => {
  await withFixture(async (client, schema) => {
    const records = await capture(client, schema);
    const header = records.find(record => record.kind === 'CAPTURE_HEADER');
    assert.equal(header.transaction_read_only, 'on');
    assert.equal(header.transaction_isolation, 'repeatable read');
    const complete = records.find(record => record.kind === 'CAPTURE_COMPLETED');
    assert.equal(complete.marker, 'DSF_CAPTURE_COMPLETED_READ_ONLY_V1');
    assert.equal(complete.transaction_finished, 'rolled_back');
    assert.equal(complete.business_parity_verified, false);
    assert.equal(complete.full_plant_history, false);
    assert.equal(records.filter(record => record.kind === 'DATASET').length, complete.expected_dataset_manifests);
    assert.equal(records.filter(record => record.kind === 'SOURCE_VALIDATION').length, complete.expected_source_validations);
    assert.deepEqual(header.planned_datasets, complete.planned_datasets);
    for (const record of records.filter(record => record.kind === 'DATASET')) assert.equal(record.manifest.status, 'complete', `${record.dataset} should execute against the declared fixture schema`);
    const empty = dataset(records, 'WHITEBOARD_EVENTS_WINDOW', EMPTY_SOURCE);
    assert.deepEqual(empty.records, []);
    assert.equal(empty.manifest.returned_rows, 0);
    assert.equal(empty.manifest.observed_rows, 0);
    assert.equal(empty.manifest.status, 'complete');
    const inventory = dataset(records, 'ALL_PLANT_SOURCE_INVENTORY', null);
    assert.equal(inventory.records.filter(row => row.department_name === 'CUTTER GRIND').length, 5);
    for (const name of ['Hard Turn (Pinions)', 'Hard Turn (Rings)', 'Shot Peen', 'Straightener', 'Thread Draw']) {
      assert.ok(inventory.records.some(row => row.department_name === name), `missing named area ${name}`);
    }
    const bounds = dataset(records, 'OP_CYCLE_BOUNDS_OVERLAPPING_WINDOW');
    assert.equal(bounds.records[0].part, 'Fixture part');
    assert.ok(!Object.hasOwn(bounds.records[0], 'serial'));
    const notes = dataset(records, 'WHITEBOARD_SHIFT_COMMENTS');
    assert.deepEqual(notes.records.map(row => row.id), [1, 2]);
    assert.equal(notes.records[0].comment, 'Approved fixture report note');
    assert.equal(notes.records[1].is_deleted, true);
    assert.equal(notes.records[1].edited_comment_id, 1);
    const output = JSON.stringify(records);
    for (const privateValue of PRIVATE_MARKERS) assert.ok(!output.includes(privateValue), `unapproved field leaked: ${privateValue}`);
    assert.ok(output.includes('SCHEMA_COMMENT_ALLOWED'), 'schema comments are distinct from operational row comments');
    assert.ok(!output.includes('OUT_OF_SCOPE_NOTE_SENTINEL'));
    // Completion is emitted after ROLLBACK: the session must no longer be read-only.
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
    assert.equal((await client.query('SELECT count(*) FROM pg_temp.tbl_whiteboard')).rows[0].count, '12');
  });
});

test('PostgreSQL: source names remain literal through quoting and generator substitution', { skip: !pgUrl }, async () => {
  await withFixture(async (client, schema) => {
    const source = { ...SOURCE, name: "Fixture's \\line; __DSF_PLANNED_DATASETS__" };
    await client.query('UPDATE pg_temp.tbl_whiteboard SET name=$1 WHERE id=$2', [source.name, uuid(4)]);
    const records = await capture(client, schema, { ...OPTIONS, sources: [source] });
    const validation = records.find(record => record.kind === 'SOURCE_VALIDATION');
    assert.equal(validation.source, source.name);
    assert.equal(validation.current.whiteboard_name, source.name);
    assert.equal(validation.manifest.status, 'validated');
  });
});

test('PostgreSQL: source identity failures suppress history, while a missing source remains explicit', { skip: !pgUrl }, async () => {
  await withFixture(async (client, schema) => {
    await event(client, 1, '2026-11-11T20:01:00Z');
    const missing = { ...SOURCE, name: 'Missing fixture', sourceId: uuid(999) };
    const mismatched = { ...SOURCE, name: 'Changed board name' };
    const records = await capture(client, schema, { ...OPTIONS, sources: [mismatched, missing] });
    for (const [source, status] of [[mismatched, 'identity_mismatch'], [missing, 'missing_source']]) {
      const validation = records.find(record => record.kind === 'SOURCE_VALIDATION' && record.source_id === source.sourceId);
      assert.equal(validation.manifest.status, status);
      const history = dataset(records, 'WHITEBOARD_EVENTS_WINDOW', source);
      assert.equal(history.manifest.status, status);
      assert.deepEqual(history.records, []);
    }
    await client.query('DELETE FROM pg_temp.tbl_department WHERE id=$1', [uuid(5)]);
    const orphaned = await capture(client, schema);
    assert.equal(dataset(orphaned, 'WHITEBOARD_EVENTS_WINDOW').manifest.status, 'missing_related_identity');
    assert.deepEqual(dataset(orphaned, 'WHITEBOARD_EVENTS_WINDOW').records, []);
  });
});

test('PostgreSQL: event history requires board and mapping, and excludes the cutoff itself', { skip: !pgUrl }, async () => {
  await withFixture(async (client, schema) => {
    await event(client, 1, WINDOW.start);
    await event(client, 2, '2026-11-11T21:00:00Z', { whiteboard_id: uuid(14) });
    await event(client, 3, '2026-11-11T21:00:00Z', { machine_id: EMPTY_SOURCE.sourceId });
    await event(client, 4, WINDOW.cutoff);
    const records = await capture(client, schema);
    assert.deepEqual(dataset(records, 'WHITEBOARD_EVENTS_WINDOW').records.map(row => row.id), [1]);
    assert.deepEqual(dataset(records, 'WHITEBOARD_EVENTS_SUCCESSOR').records.map(row => row.id), [4]);
    assert.deepEqual(dataset(records, 'WHITEBOARD_EVENTS_WINDOW', EMPTY_SOURCE).records, []);
  });
});

test('PostgreSQL: row caps expose cap+1 evidence and preserve all nearest-timestamp boundary ties', { skip: !pgUrl }, async () => {
  await withFixture(async (client, schema) => {
    for (const [id, timestamp] of [
      [1, '2026-11-11T19:58:00Z'], [2, '2026-11-11T19:59:00Z'], [3, '2026-11-11T19:59:00Z'],
      [4, '2026-11-11T20:01:00Z'], [5, '2026-11-11T20:02:00Z'], [6, '2026-11-11T20:03:00Z'], [10, '2026-11-11T20:04:00Z'],
      [7, WINDOW.cutoff], [8, WINDOW.cutoff], [9, '2026-11-12T02:01:00Z'],
    ]) await event(client, id, timestamp);
    const records = await capture(client, schema, { ...OPTIONS, rowLimit: 2 });
    const history = dataset(records, 'WHITEBOARD_EVENTS_WINDOW');
    assert.equal(history.manifest.status, 'truncated');
    assert.equal(history.manifest.truncated, true);
    assert.equal(history.manifest.returned_rows, 2);
    assert.equal(history.manifest.observed_rows, 3);
    assert.deepEqual(history.records.map(row => row.id), [4, 5]);
    for (const [name, ids] of [['WHITEBOARD_EVENTS_PREDECESSOR', [2, 3]], ['WHITEBOARD_EVENTS_SUCCESSOR', [7, 8]]]) {
      const edge = dataset(records, name);
      assert.deepEqual(edge.records.map(row => row.id), ids);
      assert.equal(edge.manifest.truncated, false);
    }
  });
});

test('PostgreSQL: absent optional schema is explicit and missing core schema aborts without completion', { skip: !pgUrl }, async () => {
  await withFixture(async (client, schema) => {
    await client.query('DROP TABLE pg_temp.tbl_op_oee');
    const records = await capture(client, schema);
    const unavailable = dataset(records, 'TBL_OP_OEE_WINDOW');
    assert.equal(unavailable.manifest.status, 'unavailable_schema');
    assert.deepEqual(unavailable.records, []);
    await client.query('ALTER TABLE pg_temp.tbl_whiteboard_machines DROP COLUMN op_id');
    await assert.rejects(capture(client, schema), error => {
      assert.equal(error.exitCode, 3);
      assert.ok(error.records.some(record => record.kind === 'CAPTURE_ERROR' && record.code === 'CORE_SCHEMA_UNAVAILABLE'));
      assert.ok(!error.records.some(record => record.kind === 'CAPTURE_COMPLETED'));
      return true;
    });
  });
});
