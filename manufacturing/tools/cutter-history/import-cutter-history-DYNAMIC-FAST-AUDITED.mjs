import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const IMPORTER_BUILD_TAG = 'CUTTER_HISTORY_DYNAMIC_FULL_REFRESH_AUDITED_20260823';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const exportDirArg = process.argv.slice(2).find((x) => !x.startsWith('--'));
const exportDir = exportDirArg ?? './tools/cutter-history/data';

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFile), '..', '..');
const loadDotEnv = (filePath) => {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};
const envValues = {
  ...loadDotEnv(path.join(projectRoot, '.env')),
  ...process.env,
};
const requiredDb = [
  'DATABASE_HOST','DATABASE_PORT','DATABASE_USERNAME','DATABASE_PASSWORD','DATABASE_NAME',
];
const missingDb = requiredDb.filter(
  (key) => typeof envValues[key] !== 'string' || envValues[key].length === 0,
);
if (missingDb.length) {
  throw new Error(`Database configuration missing: ${missingDb.join(', ')}`);
}
const client = new Client({
  host: envValues.DATABASE_HOST,
  port: Number(envValues.DATABASE_PORT),
  user: envValues.DATABASE_USERNAME,
  password: String(envValues.DATABASE_PASSWORD),
  database: envValues.DATABASE_NAME,
});

const uuid = () => crypto.randomUUID();
const clean = (v) => (v == null ? null : String(v).trim());
const upper = (v) => clean(v)?.toUpperCase() ?? null;
const isLegacyBodyPlaceholder = (v) => {
  const value = upper(v);
  return !value || new Set([
    'NA', 'N/A', 'NONE', 'UNKNOWN', 'NULL', 'TBD', 'UNASSIGNED', '-', '0',
  ]).has(value);
};
const intOrNull = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const numberOrNull = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const boolish = (v) => {
  if (v == null) return false;
  return ['1', 'TRUE', 'T', 'YES', 'Y', 'PASS', 'PASSED'].includes(upper(v));
};
const get = (row, names) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && row[name] != null && String(row[name]).trim() !== '') {
      return row[name];
    }
  }
  const keys = Object.keys(row);
  for (const wanted of names) {
    const key = keys.find((k) => k.toLowerCase() === wanted.toLowerCase());
    if (key && row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  return null;
};
const readJson = (name, optional = false) => {
  const p = path.join(exportDir, name);
  if (!fs.existsSync(p)) {
    if (optional) return [];
    throw new Error(`Missing required export file: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
};
const dateOrNull = (v) => {
  const s = clean(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dateMs = (v) => dateOrNull(v)?.getTime() ?? -Infinity;

const startedAt = Date.now();
function elapsed() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function progress(message) {
  console.log(`[${elapsed()}] ${message}`);
}

async function bulkInsertJson(table, columns, rows, chunkSize = 1000) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const cols = columns.map((c) => `"${c}"`).join(', ');
    const selectCols = columns.map((c) => `"${c}"`).join(', ');
    await client.query(
      `INSERT INTO "${table}" (${cols})
       SELECT ${selectCols}
       FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`,
      [JSON.stringify(chunk)],
    );
    progress(`${table}: ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
  }
}

const files = {
  manifest: readJson('manifest.json'),
  builds: readJson('cutter_builds_legacy.json'),
  logs: readJson('cutter_log_legacy.json'),
  setups: readJson('cutter_setups_legacy.json', true),
  frequency: readJson('cutter_frequency_legacy.json', true),
  retired: readJson('cutter_retired_legacy.json'),
  reasons: readJson('cutter_pull_reasons_legacy.json', true),
  machines: readJson('machines_legacy.json', true),
};

const report = {
  mode: apply ? 'FULL_REFRESH_APPLY' : 'FULL_REFRESH_DRY_RUN',
  source_snapshot: {
    generated_at: files.manifest?.generated_at ?? null,
    sql_server: files.manifest?.sql_server ?? null,
    sql_database: files.manifest?.sql_database ?? null,
  },
  source: {
    builds: files.builds.length,
    logs: files.logs.length,
    setups: files.setups.length,
    frequency: files.frequency.length,
    retired: files.retired.length,
    reasons: files.reasons.length,
  },
  unresolved: {
    builds_without_build_id: [],
    summaries: [],
    part_types: [],
    users: [],
    pull_reasons: [],
    duplicate_source_keys: [],
    frequency_without_log: [],
    retired_without_log: [],
    setups_without_log: [],
    current_machine: [],
    current_part: [],
  },
  skipped: {
    orphan_build_rows_without_cb_log: [],
    orphan_setup_rows_without_cs_log: [],
    orphan_frequency_rows_without_fc_log: [],
    orphan_retired_rows_without_cp_log: [],
    builds_missing_cutter_body: [],
    events_from_non_migratable_builds: {},
  },
  reconciled: {
    machine_conflicts_closed: [],
    older_builds_closed_by_newer_build: [],
    missing_or_placeholder_body_assigned_synthetic: [],
    exact_duplicate_central_logs_collapsed: [],
  },
  target_refresh: {
    existing_counts: {},
    external_fk_blockers: [],
  },
  planned: {
    bodies: 0,
    builds: 0,
    events: { BUILD: 0, SETUP: 0, FREQUENCY_CHECK: 0, PULL: 0 },
    frequency_details: 0,
    current_running: 0,
    current_available: 0,
    historical_closed: 0,
  },
};

const legacyOrphanArchiveRows = [];

function archiveLegacyOrphan(sourceType, row, reason, legacyBuildId = null) {
  legacyOrphanArchiveRows.push({
    id: uuid(),
    source_type: sourceType,
    legacy_check_id: clean(get(row, ['Check_ID'])),
    legacy_build_id: clean(legacyBuildId ?? get(row, ['Build_ID'])),
    reason,
    payload: row,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function appendLegacyComment(existing, refs = {}) {
  const parts = Object.entries(refs)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${String(v).trim()}`);
  const legacy = parts.length ? `[LEGACY ${parts.join(' ')}]` : null;
  return [clean(existing), legacy].filter(Boolean).join(' | ') || null;
}

console.log(`Importer build: ${IMPORTER_BUILD_TAG}`);
await client.connect();

async function tableExists(name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [name],
  );
  return r.rowCount > 0;
}

async function columnsFor(name) {
  const r = await client.query(
    `SELECT column_name, is_nullable, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [name],
  );
  return new Map(r.rows.map((x) => [x.column_name, x]));
}

async function fkTarget(table, column) {
  const r = await client.query(
    `SELECT ccu.table_name AS ref_table, ccu.column_name AS ref_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
     WHERE tc.table_schema='public'
       AND tc.constraint_type='FOREIGN KEY'
       AND tc.table_name=$1
       AND kcu.column_name=$2
     LIMIT 1`,
    [table, column],
  );
  return r.rows[0] ?? null;
}

async function lookupRowsForFk(table, column) {
  const fk = await fkTarget(table, column);
  if (!fk) throw new Error(`No FK metadata found for ${table}.${column}`);
  const cols = await columnsFor(fk.ref_table);
  const candidates = ['code', 'name', 'description', 'value', 'key', 'status', 'type'];
  const labelCols = candidates.filter((c) => cols.has(c));
  const select = ['id', ...labelCols].map((c) => `"${c}"`).join(', ');
  const r = await client.query(`SELECT ${select} FROM "${fk.ref_table}"`);
  return { table: fk.ref_table, rows: r.rows, labelCols };
}

function lookupText(row, labelCols) {
  return labelCols.map((c) => clean(row[c])).filter(Boolean).join(' ').toUpperCase();
}

async function resolveLookup(table, column, keywordGroups) {
  const { table: refTable, rows, labelCols } = await lookupRowsForFk(table, column);
  for (const group of keywordGroups) {
    const words = Array.isArray(group) ? group : [group];
    const found = rows.find((r) => {
      const text = lookupText(r, labelCols);
      return words.every((w) => text.includes(String(w).toUpperCase()));
    });
    if (found) return found.id;
  }
  const available = rows.map((r) => lookupText(r, labelCols)).join(' | ');
  throw new Error(
    `Could not resolve ${table}.${column} in ${refTable}. Wanted ${JSON.stringify(keywordGroups)}. Available: ${available}`,
  );
}

async function resolveOptionalLookup(table, column, keywordGroups) {
  try {
    return await resolveLookup(table, column, keywordGroups);
  } catch {
    return null;
  }
}

async function loadIdMap(table, keyColumn) {
  const r = await client.query(`SELECT id, "${keyColumn}" AS key FROM "${table}"`);
  return new Map(r.rows.filter((x) => x.key != null).map((x) => [upper(x.key), x.id]));
}

const summaryIdCache = new Map();
async function resolveSummaryId(summaryValue) {
  const s = clean(summaryValue);
  if (!s) return null;
  if (summaryIdCache.has(s)) return summaryIdCache.get(s);
  const r = await client.query(
    `SELECT id, revision
     FROM part_summaries
     WHERE number::text = $1
     ORDER BY CASE WHEN revision='' THEN 0 ELSE 1 END, revision DESC
     LIMIT 2`,
    [s],
  );
  const id = r.rows[0]?.id ?? null;
  summaryIdCache.set(s, id);
  return id;
}

const partTypeIdCache = new Map();
async function resolvePartTypeId(value) {
  const raw = upper(value);
  if (!raw) return null;

  const code =
    raw === 'G' || raw.startsWith('G') || raw === 'R' || raw.startsWith('R') || raw.includes('GEAR')
      ? 'RING'
      : raw === 'P' || raw.startsWith('P') || raw.includes('PINION')
        ? 'PINION'
        : raw;

  if (partTypeIdCache.has(code)) return partTypeIdCache.get(code);
  const r = await client.query(
    `SELECT id FROM part_types WHERE upper(code)=upper($1) AND enabled=true LIMIT 1`,
    [code],
  );
  const id = r.rows[0]?.id ?? null;
  partTypeIdCache.set(code, id);
  return id;
}

let cachedUserColumn;
const resolvedUserCache = new Map();
async function resolveUserId(empId) {
  const e = clean(empId);
  if (!e) return null;
  if (resolvedUserCache.has(e)) return resolvedUserCache.get(e);

  if (cachedUserColumn === undefined) {
    const columnCheck = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='users'
         AND column_name IN ('employeeNumber','employee_number')
       ORDER BY column_name
       LIMIT 1`,
    );
    cachedUserColumn = columnCheck.rows[0]?.column_name ?? null;
  }

  if (!cachedUserColumn) {
    resolvedUserCache.set(e, null);
    return null;
  }

  const r = await client.query(
    `SELECT id FROM users WHERE "${cachedUserColumn}"::text=$1 LIMIT 1`,
    [e],
  );
  const id = r.rows[0]?.id ?? null;
  resolvedUserCache.set(e, id);
  return id;
}

async function resolveMachine(machineValue) {
  const m = upper(machineValue);
  if (!m) return null;
  // First try direct machine_number.
  let r = await client.query(
    `SELECT id, machine_number FROM machines WHERE upper(machine_number)=upper($1) LIMIT 1`,
    [m],
  );
  if (r.rowCount) return r.rows[0];

  // Legacy setup often stores Machine_ID rather than asset number.
  const source = files.machines.find(
    (x) => clean(get(x, ['Machine_ID'])) === clean(machineValue),
  );
  const asset = upper(get(source ?? {}, ['Asset_ID', 'Machine_Number', 'Machine']));
  if (!asset) return null;
  r = await client.query(
    `SELECT id, machine_number FROM machines WHERE upper(machine_number)=upper($1) LIMIT 1`,
    [asset],
  );
  return r.rows[0] ?? null;
}

async function resolvePart(partValue) {
  const p = upper(partValue);
  if (!p) return null;
  const r = await client.query(
    `SELECT id, part_number FROM parts WHERE upper(part_number)=upper($1) LIMIT 1`,
    [p],
  );
  return r.rows[0] ?? null;
}

// Validate target tables.
for (const table of [
  'cutter_bodies',
  'cutter_builds',
  'cutter_events',
  'cutter_frequency_checks',
  'cutter_pull_reasons',
  'cutter_machine_runs',
  'parts',
  'part_summaries',
  'machines',
]) {
  if (!(await tableExists(table))) throw new Error(`Required target table missing: ${table}`);
}

const buildCols = await columnsFor('cutter_builds');
const eventCols = await columnsFor('cutter_events');
const runCols = await columnsFor('cutter_machine_runs');

// Resolve reference IDs from the database's own FK lookup tables.
const eventTypeIds = {
  BUILD: await resolveLookup('cutter_events', 'event_type_id', [['BUILD']]),
  SETUP: await resolveLookup('cutter_events', 'event_type_id', [['SETUP']]),
  FREQUENCY_CHECK: await resolveLookup('cutter_events', 'event_type_id', [
    ['FREQUENCY', 'CHECK'], ['FREQUENCY'], ['FC'],
  ]),
  PULL: await resolveLookup('cutter_events', 'event_type_id', [['PULL'], ['RETIRE']]),
};

const statusIds = {
  RUNNING: await resolveLookup('cutter_builds', 'status_id', [['RUNNING']]),
  AVAILABLE: await resolveLookup('cutter_builds', 'status_id', [
    ['AVAILABLE'], ['ON', 'SHELF'], ['SHELF'], ['READY'],
  ]),
  CLOSED: await resolveLookup('cutter_builds', 'status_id', [
    ['RETIRED'], ['CLOSED'], ['PULLED'], ['TEARDOWN'],
  ]),
};

// Pull reason IDs already exist from the base migration: PCR_001 etc.
const pullReasonRows = await client.query(`SELECT id, code, name, returns_to_shelf FROM cutter_pull_reasons`);
const pullReasonByLegacy = new Map();
for (const r of pullReasonRows.rows) {
  const m = /^PCR_(\d+)$/i.exec(clean(r.code) ?? '');
  if (m) pullReasonByLegacy.set(String(Number(m[1])), r);
}
for (const legacy of files.reasons) {
  const n = clean(get(legacy, ['PCR_ID']));
  if (!n || pullReasonByLegacy.has(String(Number(n)))) continue;
  const desc = clean(get(legacy, ['PCR_Desc']));
  const byName = pullReasonRows.rows.find((r) => upper(r.name) === upper(desc));
  if (byName) pullReasonByLegacy.set(String(Number(n)), byName);
}

// Do not silently drop a fresh legacy pull reason. The current reference table
// must contain every source PCR_ID (by PCR_### code or exact legacy description).
for (const legacy of files.reasons) {
  const n = clean(get(legacy, ['PCR_ID']));
  if (!n) continue;
  const key = String(Number(n));
  if (!pullReasonByLegacy.has(key)) {
    report.unresolved.pull_reasons.push({
      PCR_ID: n,
      PCR_Desc: clean(get(legacy, ['PCR_Desc'])),
      reason: 'source pull reason is not present in PostgreSQL cutter_pull_reasons',
    });
  }
}



// Detect ambiguous source keys before creating Maps. A Map would otherwise
// silently overwrite a duplicate Check_ID and could migrate the wrong detail row.
function duplicateValues(rows, keyName) {
  const counts = new Map();
  for (const row of rows) {
    const key = clean(get(row, [keyName]));
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1);
}

for (const [sourceName, rows] of [
  ['cutter_builds', files.builds],
  ['setups', files.setups],
  ['frequency', files.frequency],
  ['retired', files.retired],
]) {
  for (const [checkId, count] of duplicateValues(rows, 'Check_ID')) {
    report.unresolved.duplicate_source_keys.push({
      source: sourceName,
      key: 'Check_ID',
      value: checkId,
      count,
    });
  }
}

// Central log identity is ToC_ID + Check_ID. The legacy database can contain
// physically duplicated rows with different Log_ID values. Those are safe to
// collapse only when every business field is identical. Conflicting duplicates
// still stop the migration rather than guessing.
const logGroupsByExactKey = new Map();
for (const log of files.logs) {
  const toc = upper(get(log, ['ToC_ID']));
  const check = clean(get(log, ['Check_ID']));
  if (!toc || !check) continue;
  const key = `${toc}|${check}`;
  if (!logGroupsByExactKey.has(key)) logGroupsByExactKey.set(key, []);
  logGroupsByExactKey.get(key).push(log);
}

// Same ToC_ID + Check_ID is one logical legacy operation. SQL Server can
// contain rapid repeat inserts of that same operation with different Log_ID and
// Date values. Those timestamp-only duplicates must not become duplicate work.
//
// A duplicate group is safe to collapse only when the operation-defining fields
// agree: Build_ID, Check_ID, ToC_ID, Part_Count, and Emp_ID. If any of those
// differ, the migration still stops rather than guessing.
const logBusinessFingerprint = (log) => JSON.stringify({
  Build_ID: clean(get(log, ['Build_ID'])),
  Check_ID: clean(get(log, ['Check_ID'])),
  ToC_ID: upper(get(log, ['ToC_ID'])),
  Part_Count: clean(get(log, ['Part_Count'])),
  Emp_ID: clean(get(log, ['Emp_ID'])),
});

const logTimestamp = (log) => {
  const value = clean(get(log, ['Date']));
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

const effectiveLogs = [];
for (const [key, rows] of logGroupsByExactKey.entries()) {
  if (rows.length === 1) {
    effectiveLogs.push(rows[0]);
    continue;
  }

  const fingerprints = new Set(rows.map(logBusinessFingerprint));
  if (fingerprints.size === 1) {
    // Keep the earliest source occurrence for the one real operation.
    // Log_ID breaks ties when timestamps are identical/missing.
    const ordered = [...rows].sort((a, b) => {
      const timeDiff = logTimestamp(a) - logTimestamp(b);
      if (timeDiff !== 0) return timeDiff;
      return Number(get(a, ['Log_ID']) ?? 0) - Number(get(b, ['Log_ID']) ?? 0);
    });
    const kept = ordered[0];
    const discarded = ordered.slice(1);

    effectiveLogs.push(kept);

    for (const duplicate of discarded) {
      archiveLegacyOrphan(
        'CENTRAL_LOG_DUPLICATE',
        duplicate,
        `duplicate ${key}; same logical operation as kept Log_ID ${clean(get(kept, ['Log_ID']))}`,
        clean(get(duplicate, ['Build_ID'])),
      );
    }

    report.reconciled.exact_duplicate_central_logs_collapsed.push({
      key,
      count: rows.length,
      kept_log_id: clean(get(kept, ['Log_ID'])),
      kept_date: clean(get(kept, ['Date'])),
      discarded_log_ids: discarded.map((r) => clean(get(r, ['Log_ID']))),
      discarded_dates: discarded.map((r) => clean(get(r, ['Date']))),
      reason:
        'same logical ToC_ID + Check_ID operation; Build_ID, Part_Count, and Emp_ID match. Timestamp-only repeat inserts archived, not migrated as extra work.',
    });
    continue;
  }

  report.unresolved.duplicate_source_keys.push({
    source: 'central_log',
    key: 'ToC_ID+Check_ID',
    value: key,
    count: rows.length,
    reason: 'conflicting duplicate central-log rows; Build_ID, Part_Count, or Emp_ID differ',
    rows: rows.map((r) => ({
      Log_ID: clean(get(r, ['Log_ID'])),
      Build_ID: clean(get(r, ['Build_ID'])),
      Part_Count: clean(get(r, ['Part_Count'])),
      Emp_ID: clean(get(r, ['Emp_ID'])),
      Date: clean(get(r, ['Date'])),
    })),
  });
}

// Index all legacy source records by Check_ID.
const buildByCheck = new Map();
for (const row of files.builds) buildByCheck.set(clean(get(row, ['Check_ID'])), row);
const setupByCheck = new Map();
for (const row of files.setups) setupByCheck.set(clean(get(row, ['Check_ID'])), row);
const frequencyByCheck = new Map();
for (const row of files.frequency) frequencyByCheck.set(clean(get(row, ['Check_ID'])), row);
const retiredByCheck = new Map();
for (const row of files.retired) retiredByCheck.set(clean(get(row, ['Check_ID'])), row);

// Dynamic child-row cleanup. Check_ID values are reused by the legacy system,
// so a child is migratable only when the central log has the matching ToC_ID
// AND Check_ID pair. Nothing is hard-coded to a particular snapshot.
const exactLogKeys = new Set(
  effectiveLogs
    .map((log) => {
      const toc = upper(get(log, ['ToC_ID']));
      const check = clean(get(log, ['Check_ID']));
      return toc && check ? `${toc}|${check}` : null;
    })
    .filter(Boolean),
);

for (const row of files.setups) {
  const check = clean(get(row, ['Check_ID']));
  if (check && !exactLogKeys.has(`CS|${check}`)) {
    const reason = 'no exact CS + Check_ID log relationship';
    report.skipped.orphan_setup_rows_without_cs_log.push({
      check_id: check,
      reason,
    });
    archiveLegacyOrphan('SETUP', row, reason);
    setupByCheck.delete(check);
  }
}

for (const row of files.frequency) {
  const check = clean(get(row, ['Check_ID']));
  if (check && !exactLogKeys.has(`FC|${check}`)) {
    const reason = 'no exact FC + Check_ID log relationship';
    report.skipped.orphan_frequency_rows_without_fc_log.push({
      check_id: check,
      reason,
    });
    archiveLegacyOrphan('FREQUENCY', row, reason);
    frequencyByCheck.delete(check);
  }
}

for (const row of files.retired) {
  const check = clean(get(row, ['Check_ID']));
  if (check && !exactLogKeys.has(`CP|${check}`)) {
    const reason = 'no exact CP + Check_ID log relationship';
    report.skipped.orphan_retired_rows_without_cp_log.push({
      check_id: check,
      reason,
    });
    archiveLegacyOrphan('RETIRED', row, reason);
    retiredByCheck.delete(check);
  }
}

const logsByBuildId = new Map();
const buildLogByCheck = new Map();
for (const log of effectiveLogs) {
  const buildId = clean(get(log, ['Build_ID']));
  const checkId = clean(get(log, ['Check_ID']));
  const toc = upper(get(log, ['ToC_ID']));

  if (buildId) {
    if (!logsByBuildId.has(buildId)) logsByBuildId.set(buildId, []);
    logsByBuildId.get(buildId).push(log);
  }

  // Legacy Check_ID values are reused across detail tables.
  // Cutter-build rows may ONLY bind to CB log rows.
  if (toc === 'CB' && checkId && buildByCheck.has(checkId)) {
    buildLogByCheck.set(checkId, log);
  }
}
for (const rows of logsByBuildId.values()) {
  rows.sort((a, b) => dateMs(get(a, ['Date'])) - dateMs(get(b, ['Date'])));
}

// Build source model.
const sourceBuilds = [];
for (const buildRow of files.builds) {
  const checkId = clean(get(buildRow, ['Check_ID']));
  const log = buildLogByCheck.get(checkId);
  const legacyBuildId = clean(get(log ?? {}, ['Build_ID']));
  if (!legacyBuildId) {
    const reason = 'no exact CB + Check_ID log relationship';
    report.skipped.orphan_build_rows_without_cb_log.push({
      check_id: checkId,
      cutter_body_id: clean(get(buildRow, ['Cutter_Body_ID'])),
      summary: clean(get(buildRow, ['Summary'])),
      part_type: clean(get(buildRow, ['Part_Type'])),
      reason,
    });
    archiveLegacyOrphan('BUILD', buildRow, reason);
    // Archive-only by design: without the exact CB relationship there is no
    // provable legacy Build_ID. Do NOT create cutter_builds, cutter_events,
    // setup/frequency/pull events, or machine-run rows for this orphan.
    continue;
  }
  sourceBuilds.push({ buildRow, checkId, legacyBuildId, buildLog: log });
}

// Canonicalize legacy MF/Dana identifiers to the same physical cutter UUID
// before calculating increments/open-build rules. This lets history that used
// MF before etching and Dana after etching remain one continuous cutter body.
const knownBodyRows = await client.query(
  `SELECT id, dana_serial_number, mf_serial_number FROM cutter_bodies`,
);
const knownBodyCanonicalByIdentifier = new Map();
for (const row of knownBodyRows.rows) {
  if (upper(row.mf_serial_number)) {
    knownBodyCanonicalByIdentifier.set(upper(row.mf_serial_number), row.id);
  }
  if (upper(row.dana_serial_number)) {
    knownBodyCanonicalByIdentifier.set(upper(row.dana_serial_number), row.id);
  }
}

const bodyGroups = new Map();
const sourceBuildsWithBody = [];
for (const src of sourceBuilds) {
  const body = clean(get(src.buildRow, ['Cutter_Body_ID']));

  // Missing or placeholder legacy values do not identify a physical cutter.
  // Preserve the build instead of dropping it: assign a traceable synthetic MF
  // identity unique to that historical build. This keeps "bring everything"
  // semantics without pretending unrelated UNKNOWN/NA rows are one cutter.
  const rawBodyIdentifier = upper(body);
  const sourceBodyIdentifier = isLegacyBodyPlaceholder(rawBodyIdentifier)
    ? `LEGACY-UNKNOWN-${clean(src.legacyBuildId) ?? clean(src.checkId)}`
    : rawBodyIdentifier;

  if (isLegacyBodyPlaceholder(rawBodyIdentifier)) {
    report.reconciled.missing_or_placeholder_body_assigned_synthetic.push({
      check_id: src.checkId,
      legacy_build_id: src.legacyBuildId,
      source_cutter_body_id: rawBodyIdentifier,
      synthetic_mf_serial: sourceBodyIdentifier,
      reason: rawBodyIdentifier ? 'placeholder Cutter_Body_ID' : 'missing Cutter_Body_ID',
    });
  }
  const bodyGroupKey =
    knownBodyCanonicalByIdentifier.get(sourceBodyIdentifier) ??
    `UNMAPPED:${sourceBodyIdentifier}`;

  src.originalBodyIdentifier = rawBodyIdentifier;
  src.sourceBodyIdentifier = sourceBodyIdentifier;
  src.bodyGroupKey = bodyGroupKey;
  sourceBuildsWithBody.push(src);

  if (!bodyGroups.has(bodyGroupKey)) bodyGroups.set(bodyGroupKey, []);
  bodyGroups.get(bodyGroupKey).push(src);
}
sourceBuilds.length = 0;
sourceBuilds.push(...sourceBuildsWithBody);

// Increment is chronological per physical body.
for (const group of bodyGroups.values()) {
  group.sort((a, b) =>
    dateMs(get(a.buildLog, ['Date'])) - dateMs(get(b.buildLog, ['Date']))
    || Number(a.legacyBuildId) - Number(b.legacyBuildId)
  );
  group.forEach((x, i) => { x.buildIncrement = i + 1; });
}

// Build current-state model from SETUP and retired/pull events.
for (const src of sourceBuilds) {
  const logs = logsByBuildId.get(src.legacyBuildId) ?? [];
  let latestSetup = null;
  let latestPull = null;

  for (const log of logs) {
    const checkId = clean(get(log, ['Check_ID']));
    const toc = upper(get(log, ['ToC_ID']));

    if (toc === 'CS' && setupByCheck.has(checkId)) {
      if (!latestSetup || dateMs(get(log, ['Date'])) > dateMs(get(latestSetup.log, ['Date']))) {
        latestSetup = { log, detail: setupByCheck.get(checkId) };
      }
    }

    if (toc === 'CP' && retiredByCheck.has(checkId)) {
      if (!latestPull || dateMs(get(log, ['Date'])) > dateMs(get(latestPull.log, ['Date']))) {
        latestPull = { log, detail: retiredByCheck.get(checkId) };
      }
    }
  }

  const lastSetupMs = latestSetup ? dateMs(get(latestSetup.log, ['Date'])) : -Infinity;
  const lastPullMs = latestPull ? dateMs(get(latestPull.log, ['Date'])) : -Infinity;

  let state = 'AVAILABLE';
  if (latestPull && lastPullMs >= lastSetupMs) {
    const legacyReasonId = clean(get(latestPull.detail, ['PCR_ID']));
    const reason = pullReasonByLegacy.get(String(Number(legacyReasonId)));
    state = reason?.returns_to_shelf ? 'AVAILABLE' : 'CLOSED';
  } else if (latestSetup && lastSetupMs > lastPullMs) {
    state = 'RUNNING';
  }

  src.latestSetup = latestSetup;
  src.latestPull = latestPull;
  src.state = state;

}


// Enforce the new-db invariant: a physical cutter body may have only ONE open build.
// The newest build for a body keeps its calculated current state.
// Every older build is closed and gets a completed_at based on its pull date when
// available, otherwise the next build's build timestamp.
for (const group of bodyGroups.values()) {
  group.sort((a, b) =>
    dateMs(get(a.buildLog, ['Date'])) - dateMs(get(b.buildLog, ['Date']))
    || String(a.legacyBuildId).localeCompare(String(b.legacyBuildId))
  );

  for (let i = 0; i < group.length; i++) {
    const src = group[i];
    const isNewest = i === group.length - 1;
    src.isNewestForBody = isNewest;

    if (!isNewest) {
      const nextBuild = group[i + 1];
      src.stateBeforeNewestRule = src.state;
      src.state = 'CLOSED';
      src.forcedClosedByNewerBuild = true;
      report.reconciled.older_builds_closed_by_newer_build.push({
        cutter_body: src.sourceBodyIdentifier,
        closed_legacy_build: src.legacyBuildId,
        kept_legacy_build: group[group.length - 1].legacyBuildId,
        reason: 'newer build exists for same physical cutter body',
      });
      src.closedAt =
        dateOrNull(get(src.latestPull?.log ?? {}, ['Date'])) ??
        dateOrNull(get(nextBuild.buildLog ?? {}, ['Date'])) ??
        dateOrNull(get(src.buildLog ?? {}, ['Date']));
    } else if (src.state === 'CLOSED') {
      src.closedAt =
        dateOrNull(get(src.latestPull?.log ?? {}, ['Date'])) ??
        dateOrNull(get(src.buildLog ?? {}, ['Date']));
    } else {
      src.closedAt = null;
    }
  }
}


// Enforce the new-db invariant: only ONE active cutter run may exist per machine.
// Legacy data can leave multiple builds looking RUNNING on the same machine.
// Keep the build with the newest setup timestamp; close the older conflicting build(s).
const runningByMachine = new Map();

for (const src of sourceBuilds.filter((x) => x.state === 'RUNNING')) {
  const d = src.latestSetup?.detail;
  const machineValue = get(d ?? {}, ['Machine_ID', 'Machine', 'Machine_Number', 'Asset_ID']);
  const machine = await resolveMachine(machineValue);

  if (!machine) {
    report.unresolved.current_machine.push({
      build: src.buildNumber ?? src.legacyBuildId,
      legacy_build: src.legacyBuildId,
      value: clean(machineValue),
    });
    continue;
  }

  src.resolvedCurrentMachine = machine;
  const machineKey = String(machine.id);

  if (!runningByMachine.has(machineKey)) runningByMachine.set(machineKey, []);
  runningByMachine.get(machineKey).push(src);
}

for (const group of runningByMachine.values()) {
  if (group.length <= 1) continue;

  group.sort((a, b) =>
    dateMs(get(a.latestSetup?.log ?? {}, ['Date'])) -
      dateMs(get(b.latestSetup?.log ?? {}, ['Date'])) ||
    String(a.legacyBuildId).localeCompare(String(b.legacyBuildId))
  );

  const keeper = group[group.length - 1];
  const keeperSetupDate =
    dateOrNull(get(keeper.latestSetup?.log ?? {}, ['Date'])) ??
    dateOrNull(get(keeper.buildLog ?? {}, ['Date']));

  for (const src of group.slice(0, -1)) {
    src.stateBeforeMachineRule = src.state;
    src.state = 'CLOSED';
    src.forcedClosedByMachineConflict = true;
    src.machineConflictKeeperLegacyBuildId = keeper.legacyBuildId;
    src.closedAt =
      dateOrNull(get(src.latestPull?.log ?? {}, ['Date'])) ??
      keeperSetupDate ??
      dateOrNull(get(src.latestSetup?.log ?? {}, ['Date'])) ??
      dateOrNull(get(src.buildLog ?? {}, ['Date']));

    report.reconciled.machine_conflicts_closed.push({
      machine: keeper.resolvedCurrentMachine?.machine_number ?? null,
      closed_legacy_build: src.legacyBuildId,
      kept_legacy_build: keeper.legacyBuildId,
      closed_at: src.closedAt?.toISOString?.() ?? null,
      reason: 'newer legacy setup exists on same machine',
    });
  }
}

// Safety check: after reconciliation there must be at most one RUNNING build per machine.
const plannedRunningByMachine = new Map();
for (const src of sourceBuilds.filter((x) => x.state === 'RUNNING')) {
  const machineId = src.resolvedCurrentMachine?.id;
  if (!machineId) continue;
  if (!plannedRunningByMachine.has(machineId)) plannedRunningByMachine.set(machineId, []);
  plannedRunningByMachine.get(machineId).push(src.legacyBuildId);
}
const plannedMachineRunViolations = [...plannedRunningByMachine.entries()]
  .filter(([, builds]) => builds.length > 1)
  .map(([machine_id, builds]) => ({ machine_id, builds }));


// Resolve the current part for the FINAL set of RUNNING builds during dry-run.
// This prevents a dry-run PASS followed by an APPLY failure for an unknown part.
for (const src of sourceBuilds.filter((x) => x.state === 'RUNNING')) {
  const d = src.latestSetup?.detail ?? {};
  const partValue = get(d, ['Part_Number', 'Part', 'Gear', 'Pinion']);
  const part = await resolvePart(partValue);
  if (!part) {
    report.unresolved.current_part.push({
      build: src.buildNumber ?? src.legacyBuildId,
      legacy_build: src.legacyBuildId,
      value: clean(partValue),
    });
  } else {
    src.resolvedCurrentPart = part;
  }
}

// Recompute current-state totals AFTER enforcing newest-only open builds.
report.planned.current_running = 0;
report.planned.current_available = 0;
report.planned.historical_closed = 0;

for (const src of sourceBuilds) {
  if (src.state === 'RUNNING') report.planned.current_running++;
  else if (src.state === 'AVAILABLE') report.planned.current_available++;
  else report.planned.historical_closed++;
}

// Safety check: never allow more than one non-closed build for a cutter body.
const plannedOpenByBody = new Map();
for (const src of sourceBuilds) {
  if (src.state === 'CLOSED') continue;
  const key = src.bodyGroupKey;
  if (!plannedOpenByBody.has(key)) plannedOpenByBody.set(key, []);
  plannedOpenByBody.get(key).push(src.legacyBuildId);
}
const plannedOpenViolations = [...plannedOpenByBody.entries()]
  .filter(([, builds]) => builds.length > 1)
  .map(([body, builds]) => ({ body, builds }));


const migratableLegacyBuildIds = new Set(
  sourceBuilds.map((x) => clean(x.legacyBuildId)).filter(Boolean),
);


// Validate every non-null employee referenced by migratable history.
// Missing users would otherwise be silently written as NULL.
const missingUserIds = new Set();
for (const log of effectiveLogs) {
  const legacyBuildId = clean(get(log, ['Build_ID']));
  if (!migratableLegacyBuildIds.has(legacyBuildId)) continue;
  const empId = clean(get(log, ['Emp_ID']));
  if (!empId) continue;
  if (!(await resolveUserId(empId))) missingUserIds.add(empId);
}
report.unresolved.users = [...missingUserIds]
  .sort()
  .map((employee_id) => ({
    employee_id,
    reason: 'legacy Emp_ID not found in PostgreSQL users',
  }));

const migratableSourceCounts = { setup: 0, frequency: 0, pull: 0 };
for (const log of effectiveLogs) {
  const legacyBuildId = clean(get(log, ['Build_ID']));
  if (!migratableLegacyBuildIds.has(legacyBuildId)) continue;

  const checkId = clean(get(log, ['Check_ID']));
  const toc = upper(get(log, ['ToC_ID']));
  if (toc === 'CS' && setupByCheck.has(checkId)) migratableSourceCounts.setup++;
  if (toc === 'FC' && frequencyByCheck.has(checkId)) migratableSourceCounts.frequency++;
  if (toc === 'CP' && retiredByCheck.has(checkId)) migratableSourceCounts.pull++;
}

// Pre-resolve core relationships and build numbers.
for (const src of sourceBuilds) {
  const body = src.sourceBodyIdentifier;
  const summary = clean(get(src.buildRow, ['Summary']));

  // Legacy data occasionally has a NULL Part_Type even though the legacy
  // Build_ID itself encodes the type. Use the explicit field first, then
  // safely fall back to the legacy build prefix:
  //   G... => Gear => RING
  //   P... => Pinion => PINION
  const explicitPartType = clean(get(src.buildRow, ['Part_Type']));
  const legacyPrefix = upper(src.legacyBuildId)?.charAt(0) ?? null;
  const partType =
    explicitPartType ??
    (legacyPrefix === 'G' ? 'G' : legacyPrefix === 'P' ? 'P' : null);

  const summaryId = await resolveSummaryId(summary);
  const partTypeId = await resolvePartTypeId(partType);

  if (!summaryId) report.unresolved.summaries.push({ build: src.legacyBuildId, summary });
  if (!partTypeId) report.unresolved.part_types.push({ build: src.legacyBuildId, part_type: partType });

  src.body = body;
  src.summary = summary;
  src.summaryId = summaryId;
  src.partTypeId = partTypeId;

  const prefix = upper(partType)?.startsWith('P') ? 'P' : 'R';
  src.buildNumber = `${prefix}-${body}-${String(src.buildIncrement ?? 1).padStart(3, '0')}-${summary}`;
}

// Every build needs a resolvable summary + part type before apply.
const coreUnresolved =
  report.unresolved.summaries.length +
  report.unresolved.part_types.length +
  report.unresolved.users.length +
  report.unresolved.pull_reasons.length +
  report.unresolved.duplicate_source_keys.length +
  report.unresolved.current_machine.length +
  report.unresolved.current_part.length;

report.planned.bodies = bodyGroups.size;
report.planned.builds = sourceBuilds.length;
report.planned.events.BUILD = sourceBuilds.length;

// Planned target events use only migratable Build_IDs, exactly like APPLY.
for (const log of effectiveLogs) {
  const legacyBuildId = clean(get(log, ['Build_ID']));
  if (!migratableLegacyBuildIds.has(legacyBuildId)) continue;

  const check = clean(get(log, ['Check_ID']));
  const toc = upper(get(log, ['ToC_ID']));

  if (toc === 'CS' && setupByCheck.has(check)) report.planned.events.SETUP++;
  if (toc === 'FC' && frequencyByCheck.has(check)) {
    report.planned.events.FREQUENCY_CHECK++;
    report.planned.frequency_details++;
  }
  if (toc === 'CP' && retiredByCheck.has(check)) report.planned.events.PULL++;
}

report.skipped.events_from_non_migratable_builds = {
  setup: files.setups.length - migratableSourceCounts.setup,
  frequency: files.frequency.length - migratableSourceCounts.frequency,
  pull: files.retired.length - migratableSourceCounts.pull,
};

report.planned.legacy_orphan_archive = legacyOrphanArchiveRows.length;

report.planned.count_reconciliation = {
  raw_setup_source: files.setups.length,
  migratable_setup_source: migratableSourceCounts.setup,
  setup_planned: report.planned.events.SETUP,

  raw_frequency_source: files.frequency.length,
  migratable_frequency_source: migratableSourceCounts.frequency,
  frequency_planned: report.planned.events.FREQUENCY_CHECK,

  raw_retired_source: files.retired.length,
  migratable_pull_source: migratableSourceCounts.pull,
  pull_planned: report.planned.events.PULL,
};


const refreshTables = [
  'cutter_cmm_checks',
  'cutter_frequency_checks',
  'cutter_machine_runs',
  'cutter_build_locations',
  'cutter_build_trays',
  'cutter_build_blades',
  'cutter_teardowns',
  'cutter_events',
  'cutter_builds',
];

for (const table of refreshTables) {
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  report.target_refresh.existing_counts[table] = r.rows[0].n;
}

// Protect data owned by other apps/modules. If another table currently contains
// rows referencing cutter data, this full refresh stops rather than cascading
// into blade tracking or another feature.
const externalFks = await client.query(
  `SELECT
     tc.table_name AS source_table,
     kcu.column_name AS source_column,
     ccu.table_name AS target_table,
     ccu.column_name AS target_column
   FROM information_schema.table_constraints tc
   JOIN information_schema.key_column_usage kcu
     ON tc.constraint_name=kcu.constraint_name
    AND tc.table_schema=kcu.table_schema
   JOIN information_schema.constraint_column_usage ccu
     ON ccu.constraint_name=tc.constraint_name
    AND ccu.table_schema=tc.table_schema
   WHERE tc.table_schema='public'
     AND tc.constraint_type='FOREIGN KEY'
     AND ccu.table_name = ANY($1::text[])
     AND NOT (tc.table_name = ANY($1::text[]))
   ORDER BY tc.table_name, kcu.column_name`,
  [refreshTables],
);

for (const fk of externalFks.rows) {
  const q = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM "${fk.source_table}" s
     JOIN "${fk.target_table}" t
       ON s."${fk.source_column}" = t."${fk.target_column}"`,
  );
  if (q.rows[0].n > 0) {
    report.target_refresh.external_fk_blockers.push({
      ...fk,
      referencing_rows: q.rows[0].n,
      reason: 'another app/module currently references cutter data',
    });
  }
}

const migrationReportPath = path.resolve('./cutter-history-dynamic-migration-report.json');
fs.writeFileSync(migrationReportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`Dynamic migration report: ${migrationReportPath}`);

console.log('\nGearApps cutter-history import plan');
console.log('===================================');
console.log(JSON.stringify(report, null, 2));

if (coreUnresolved > 0) {
  console.error(`\n[STOP] ${coreUnresolved} core build relationship(s) are unresolved.`);
  console.error('No data was written.');
  await client.end();
  process.exit(2);
}

if (plannedOpenViolations.length > 0) {
  console.error('\n[STOP] More than one open build is planned for a cutter body:');
  console.error(JSON.stringify(plannedOpenViolations, null, 2));
  console.error('No data was written.');
  await client.end();
  process.exit(3);
}

if (plannedMachineRunViolations.length > 0) {
  console.error('\n[STOP] More than one active cutter run is still planned for a machine:');
  console.error(JSON.stringify(plannedMachineRunViolations, null, 2));
  console.error('No data was written.');
  await client.end();
  process.exit(6);
}

if (report.target_refresh.external_fk_blockers.length > 0) {
  console.error('\n[STOP] Full refresh is blocked because another app/module references cutter data:');
  console.error(JSON.stringify(report.target_refresh.external_fk_blockers, null, 2));
  console.error('Nothing was changed.');
  await client.end();
  process.exit(5);
}

const countRec = report.planned.count_reconciliation;
if (
  countRec.migratable_setup_source !== countRec.setup_planned ||
  countRec.migratable_frequency_source !== countRec.frequency_planned ||
  countRec.migratable_pull_source !== countRec.pull_planned
) {
  console.error('\n[STOP] Legacy detail counts do not reconcile to ToC_ID + Check_ID events.');
  console.error(JSON.stringify(countRec, null, 2));
  console.error('No data was written.');
  await client.end();
  process.exit(4);
}

if (!apply) {
  console.log('\n[DRY RUN PASS] Dynamic full-refresh plan is clean.');
  console.log('Run the same command with --apply to replace cutter tracking data transactionally.');
  console.log('No data was written.');
  await client.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// APPLY: FAST BULK PATH. One PostgreSQL transaction.
// ---------------------------------------------------------------------------
await client.query('BEGIN');

try {
  progress('Dynamic full-refresh transaction started');

  await client.query(`
    CREATE TABLE IF NOT EXISTS cutter_legacy_orphan_records (
      id uuid PRIMARY KEY,
      source_type varchar NOT NULL,
      legacy_check_id varchar NULL,
      legacy_build_id varchar NULL,
      reason text NOT NULL,
      payload jsonb NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT NOW(),
      "updatedAt" timestamp NOT NULL DEFAULT NOW(),
      "createdBy" varchar NULL,
      "updatedBy" varchar NULL,
      "deletedAt" timestamp NULL,
      "deletedBy" varchar NULL
    )
  `);
  await client.query('DELETE FROM cutter_legacy_orphan_records');
  progress('cleared cutter_legacy_orphan_records');

  progress('Clearing existing cutter tracking test/history data');

  // Replace current cutter operational/history rows from the fresh SQL Server
  // snapshot. Physical cutter-body identity/reference rows are deliberately
  // preserved so Excel MF<->Dana mappings and definition links survive.
  //
  // These newer Gear Apps association tables do not exist in the legacy source,
  // so stale/test rows must be cleared before cutter_builds can be refreshed.
  for (const table of [
    'cutter_cmm_checks',
    'cutter_frequency_checks',
    'cutter_machine_runs',
    'cutter_build_locations',
    'cutter_build_trays',
    'cutter_build_blades',
    'cutter_teardowns',
    'cutter_events',
    'cutter_builds',
  ]) {
    await client.query(`DELETE FROM "${table}"`);
    progress(`cleared ${table}`);
  }

  // -------------------------------------------------------------
  // Preload all reference IDs ONCE.
  // -------------------------------------------------------------
  progress('Loading users, machines, parts, and existing cutter bodies');

  const userColumnResult = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users'
       AND column_name IN ('employeeNumber','employee_number')
     ORDER BY column_name
     LIMIT 1`,
  );
  const userColumn = userColumnResult.rows[0]?.column_name;
  const userRows = userColumn
    ? await client.query(`SELECT id, "${userColumn}"::text AS employee_no FROM users`)
    : { rows: [] };
  const userMap = new Map(
    userRows.rows
      .filter((r) => clean(r.employee_no))
      .map((r) => [clean(r.employee_no), r.id]),
  );

  const machineRows = await client.query(`SELECT id, machine_number FROM machines`);
  const machineByNumber = new Map(
    machineRows.rows.map((r) => [upper(r.machine_number), r]),
  );
  const legacyMachineToNumber = new Map();
  for (const m of files.machines) {
    const id = clean(get(m, ['Machine_ID']));
    const number = upper(get(m, ['Asset_ID', 'Machine_Number', 'Machine']));
    if (id && number) legacyMachineToNumber.set(id, number);
  }

  const partRows = await client.query(`SELECT id, part_number FROM parts`);
  const partByNumber = new Map(
    partRows.rows.map((r) => [upper(r.part_number), r]),
  );

  const bodyRows = await client.query(
    `SELECT id, dana_serial_number, mf_serial_number FROM cutter_bodies`,
  );
  const bodyIdBySerial = new Map();
  for (const r of bodyRows.rows) {
    if (upper(r.mf_serial_number)) {
      bodyIdBySerial.set(upper(r.mf_serial_number), r.id);
    }
    if (upper(r.dana_serial_number)) {
      bodyIdBySerial.set(upper(r.dana_serial_number), r.id);
    }
  }

  const passCheckResultId = await resolveOptionalLookup(
    'cutter_events', 'check_result_id', [['PASS']],
  );
  const failCheckResultId = await resolveOptionalLookup(
    'cutter_events', 'check_result_id', [['FAIL']],
  );

  const userIdFor = (empId) => userMap.get(clean(empId)) ?? null;
  const machineFor = (value) => {
    const raw = clean(value);
    if (!raw) return null;
    const direct = machineByNumber.get(upper(raw));
    if (direct) return direct;
    const translated = legacyMachineToNumber.get(raw);
    return translated ? machineByNumber.get(translated) ?? null : null;
  };
  const partFor = (value) => partByNumber.get(upper(value)) ?? null;

  // -------------------------------------------------------------
  // Prepare all rows in memory.
  // -------------------------------------------------------------

  // Existing cutter machine runs were cleared transactionally above.

  progress('Preparing bulk rows in memory');

  const bodyInsertRows = [];
  for (const src of sourceBuilds) {
    const key = upper(src.body);
    if (!bodyIdBySerial.has(key)) {
      const id = uuid();
      bodyIdBySerial.set(key, id);
      // Unknown legacy cutter identifiers are treated as manufacturer/MF
      // serials. We never invent a Dana S/N: Dana is assigned only after the
      // physical cutter is etched.
      bodyInsertRows.push({
        id,
        dana_serial_number: null,
        mf_serial_number: src.body,
        definition_id: null,
        description: src.originalBodyIdentifier && isLegacyBodyPlaceholder(src.originalBodyIdentifier)
          ? `Migrated legacy cutter body; source placeholder was ${src.originalBodyIdentifier}`
          : 'Migrated legacy cutter body (MF-only until matched/etched)',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const buildUuidByLegacy = new Map();
  const buildInsertRows = [];
  const buildEventRows = [];
  const setupEventRows = [];
  const frequencyEventRows = [];
  const frequencyDetailRows = [];
  const pullEventRows = [];
  const machineRunRows = [];

  for (const src of sourceBuilds) {
    const bodyId = bodyIdBySerial.get(upper(src.body));
    const newBuildId = uuid();
    buildUuidByLegacy.set(src.legacyBuildId, newBuildId);

    const builtBy = userIdFor(get(src.buildLog, ['Emp_ID']));
    const builtAt = dateOrNull(get(src.buildLog, ['Date']))?.toISOString() ?? null;
    const statusId =
      src.state === 'RUNNING' ? statusIds.RUNNING
      : src.state === 'AVAILABLE' ? statusIds.AVAILABLE
      : statusIds.CLOSED;

    buildInsertRows.push({
      id: newBuildId,
      build_number: src.buildNumber,
      build_increment: src.buildIncrement,
      cutter_body_id: bodyId,
      summary_id: src.summaryId,
      part_type_id: src.partTypeId,
      status_id: statusId,
      honed: boolish(get(src.buildRow, ['Honed'])),
      coated: boolish(get(src.buildRow, ['Coated'])),
      ib_ro: clean(get(src.buildRow, ['IB_RO'])),
      ob_ro: clean(get(src.buildRow, ['OB_RO'])),
      comments: appendLegacyComment(get(src.buildRow, ['Comment', 'Comments']), {
        Build_ID: src.legacyBuildId,
        Build_Check_ID: src.checkId,
        Forced_Closed_By_Newer_Build: src.forcedClosedByNewerBuild ? 'true' : null,
        Forced_Closed_By_Machine_Conflict: src.forcedClosedByMachineConflict ? 'true' : null,
        Machine_Conflict_Kept_Build: src.machineConflictKeeperLegacyBuildId ?? null,
      }),
      built_by_user_id: builtBy,
      built_at: builtAt,
      completed_at: src.state === 'CLOSED'
        ? (src.closedAt?.toISOString?.() ?? src.closedAt ?? null)
        : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    buildEventRows.push({
      id: uuid(),
      cutter_build_id: newBuildId,
      event_type_id: eventTypeIds.BUILD,
      piece_count: intOrNull(get(src.buildLog, ['Part_Count'])),
      machine_number: null,
      part_number: null,
      user_id: builtBy,
      check_result_id: null,
      pull_reason_id: null,
      occurred_at: builtAt,
      comments: appendLegacyComment(get(src.buildRow, ['Comment', 'Comments']), {
        Log_ID: get(src.buildLog, ['Log_ID']),
        Check_ID: src.checkId,
        Legacy_Build_ID: src.legacyBuildId,
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  for (const log of effectiveLogs) {
    const legacyBuildId = clean(get(log, ['Build_ID']));
    const newBuildId = buildUuidByLegacy.get(legacyBuildId);
    if (!newBuildId) continue;

    const checkId = clean(get(log, ['Check_ID']));
    const toc = upper(get(log, ['ToC_ID']));
    const userId = userIdFor(get(log, ['Emp_ID']));
    const occurredAt = dateOrNull(get(log, ['Date']))?.toISOString() ?? null;
    const pieceCount = intOrNull(get(log, ['Part_Count']));
    const now = new Date().toISOString();

    if (toc === 'CS' && setupByCheck.has(checkId)) {
      const d = setupByCheck.get(checkId);
      const machineValue = get(d, ['Machine_ID', 'Machine', 'Machine_Number', 'Asset_ID']);
      const partValue = get(d, ['Part_Number', 'Part', 'Gear', 'Pinion']);
      const machine = machineFor(machineValue);
      const part = partFor(partValue);

      setupEventRows.push({
        id: uuid(),
        cutter_build_id: newBuildId,
        event_type_id: eventTypeIds.SETUP,
        piece_count: pieceCount,
        machine_number: machine?.machine_number ?? clean(machineValue),
        part_number: part?.part_number ?? clean(partValue),
        user_id: userId,
        check_result_id: null,
        pull_reason_id: null,
        occurred_at: occurredAt,
        comments: appendLegacyComment(get(d, ['Comments', 'Comment']), {
          Log_ID: get(log, ['Log_ID']),
          Check_ID: checkId,
          Legacy_Build_ID: legacyBuildId,
        }),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (toc === 'FC' && frequencyByCheck.has(checkId)) {
      const d = frequencyByCheck.get(checkId);
      const passed =
        boolish(get(d, ['Pass_Fail'])) ||
        upper(get(d, ['Pass_Fail'])) === 'PASS';
      const eventId = uuid();

      frequencyEventRows.push({
        id: eventId,
        cutter_build_id: newBuildId,
        event_type_id: eventTypeIds.FREQUENCY_CHECK,
        piece_count: pieceCount,
        machine_number: null,
        part_number: null,
        user_id: userId,
        check_result_id: passed ? passCheckResultId : failCheckResultId,
        pull_reason_id: null,
        occurred_at: occurredAt,
        comments: appendLegacyComment(get(d, ['Comments', 'Comment']), {
          Log_ID: get(log, ['Log_ID']),
          Check_ID: checkId,
          Legacy_Build_ID: legacyBuildId,
        }),
        createdAt: now,
        updatedAt: now,
      });

      frequencyDetailRows.push({
        id: uuid(),
        event_id: eventId,
        pass_fail: clean(get(d, ['Pass_Fail'])),
        s_e_square: numberOrNull(get(d, ['S_E_Square'])),
        s_e_after: numberOrNull(get(d, ['S_E_After'])),
        s_e_result: clean(get(d, ['S_E_Result'])),
        total_fr: numberOrNull(get(d, ['Total_Fr'])),
        tooth_thickness: numberOrNull(get(d, ['Tooth_Thickness'])),
        flank1_pa: numberOrNull(get(d, ['Flank_1_PA', 'Flank1_PA'])),
        flank1_sa: numberOrNull(get(d, ['Flank_1_SA', 'Flank1_SA'])),
        flank2_pa: numberOrNull(get(d, ['Flank_2_PA', 'Flank2_PA'])),
        flank2_sa: numberOrNull(get(d, ['Flank_2_SA', 'Flank2_SA'])),
        size_check: clean(get(d, ['Size_Check'])),
        comments: appendLegacyComment(get(d, ['Comments', 'Comment']), {
          Check_ID: checkId,
        }),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (toc === 'CP' && retiredByCheck.has(checkId)) {
      const d = retiredByCheck.get(checkId);
      const legacyReason = clean(get(d, ['PCR_ID']));
      const reason = pullReasonByLegacy.get(String(Number(legacyReason)));

      pullEventRows.push({
        id: uuid(),
        cutter_build_id: newBuildId,
        event_type_id: eventTypeIds.PULL,
        piece_count: pieceCount,
        machine_number: null,
        part_number: null,
        user_id: userId,
        check_result_id: null,
        pull_reason_id: reason?.id ?? null,
        occurred_at: occurredAt,
        comments: appendLegacyComment(get(d, ['Comments', 'Comment']), {
          Log_ID: get(log, ['Log_ID']),
          Check_ID: checkId,
          Legacy_Build_ID: legacyBuildId,
          PCR_ID: legacyReason,
        }),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  for (const src of sourceBuilds.filter((x) => x.state === 'RUNNING')) {
    const d = src.latestSetup.detail;
    const machineValue = get(d, ['Machine_ID', 'Machine', 'Machine_Number', 'Asset_ID']);
    const partValue = get(d, ['Part_Number', 'Part', 'Gear', 'Pinion']);
    const machine = src.resolvedCurrentMachine ?? machineFor(machineValue);
    const part = src.resolvedCurrentPart ?? partFor(partValue);

    if (!machine) {
      report.unresolved.current_machine.push({
        build: src.buildNumber,
        legacy_build: src.legacyBuildId,
        value: clean(machineValue),
      });
      continue;
    }
    if (!part) {
      report.unresolved.current_part.push({
        build: src.buildNumber,
        legacy_build: src.legacyBuildId,
        value: clean(partValue),
      });
      continue;
    }

    const logs = logsByBuildId.get(src.legacyBuildId) ?? [];
    const maxPiece = Math.max(
      0,
      ...logs.map((x) => intOrNull(get(x, ['Part_Count'])) ?? 0),
    );

    machineRunRows.push({
      id: uuid(),
      cutter_build_id: buildUuidByLegacy.get(src.legacyBuildId),
      machine_id: machine.id,
      part_id: part.id,
      machine_number: machine.machine_number,
      shift: clean(get(d, ['Shift'])),
      installed_at: dateOrNull(get(src.latestSetup.log, ['Date']))?.toISOString() ?? null,
      removed_at: null,
      current_piece_count: maxPiece,
      last_check_piece_count: maxPiece,
      installed_by_user_id: userIdFor(get(src.latestSetup.log, ['Emp_ID'])),
      removed_by_user_id: null,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  if (report.unresolved.current_machine.length || report.unresolved.current_part.length) {
    throw new Error(
      `Current-running migration unresolved: ${report.unresolved.current_machine.length} machine(s), ` +
      `${report.unresolved.current_part.length} part(s). Transaction rolled back.`,
    );
  }

  progress(
    `Prepared ${buildInsertRows.length} builds, ` +
    `${setupEventRows.length} setups, ${frequencyEventRows.length} frequency checks, ` +
    `${pullEventRows.length} pulls`,
  );

  // -------------------------------------------------------------
  // Bulk inserts.
  // -------------------------------------------------------------
  await bulkInsertJson(
    'cutter_legacy_orphan_records',
    [
      'id','source_type','legacy_check_id','legacy_build_id','reason','payload',
      'createdAt','updatedAt'
    ],
    legacyOrphanArchiveRows,
    500,
  );

  await bulkInsertJson(
    'cutter_bodies',
    [
      'id','dana_serial_number','mf_serial_number','definition_id',
      'description','enabled','createdAt','updatedAt'
    ],
    bodyInsertRows,
    500,
  );

  await bulkInsertJson(
    'cutter_builds',
    [
      'id','build_number','build_increment','cutter_body_id','summary_id','part_type_id',
      'status_id','honed','coated','ib_ro','ob_ro','comments','built_by_user_id',
      'built_at','completed_at','createdAt','updatedAt'
    ],
    buildInsertRows,
    500,
  );

  const eventColumns = [
    'id','cutter_build_id','event_type_id','piece_count','machine_number','part_number',
    'user_id','check_result_id','pull_reason_id','occurred_at','comments','createdAt','updatedAt'
  ];

  await bulkInsertJson('cutter_events', eventColumns, buildEventRows, 1000);
  await bulkInsertJson('cutter_events', eventColumns, setupEventRows, 1000);
  await bulkInsertJson('cutter_events', eventColumns, frequencyEventRows, 1000);
  await bulkInsertJson(
    'cutter_frequency_checks',
    [
      'id','event_id','pass_fail','s_e_square','s_e_after','s_e_result','total_fr',
      'tooth_thickness','flank1_pa','flank1_sa','flank2_pa','flank2_sa','size_check',
      'comments','createdAt','updatedAt'
    ],
    frequencyDetailRows,
    1000,
  );
  await bulkInsertJson('cutter_events', eventColumns, pullEventRows, 1000);

  await bulkInsertJson(
    'cutter_machine_runs',
    [
      'id','cutter_build_id','machine_id','part_id','machine_number','shift',
      'installed_at','removed_at','current_piece_count','last_check_piece_count',
      'installed_by_user_id','removed_by_user_id','enabled','createdAt','updatedAt'
    ],
    machineRunRows,
    500,
  );

  // -------------------------------------------------------------
  // Final validation.
  // -------------------------------------------------------------
  progress('Running final relational validation');

  const checks = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM cutter_builds WHERE build_number = ANY($1::text[]))::int AS builds,
      (SELECT COUNT(*) FROM cutter_events e
         JOIN cutter_builds b ON b.id=e.cutter_build_id
         WHERE b.build_number = ANY($1::text[]))::int AS events,
      (SELECT COUNT(*) FROM cutter_frequency_checks f
         JOIN cutter_events e ON e.id=f.event_id
         JOIN cutter_builds b ON b.id=e.cutter_build_id
         WHERE b.build_number = ANY($1::text[]))::int AS frequency_details,
      (SELECT COUNT(*) FROM cutter_machine_runs r
         JOIN cutter_builds b ON b.id=r.cutter_build_id
         WHERE b.build_number = ANY($1::text[])
           AND r.removed_at IS NULL AND r.enabled=true)::int AS running
  `, [sourceBuilds.map((x) => x.buildNumber)]);

  if (checks.rows[0].builds !== sourceBuilds.length) {
    throw new Error(`Build verification mismatch: ${checks.rows[0].builds} vs ${sourceBuilds.length}`);
  }
  if (checks.rows[0].frequency_details !== frequencyDetailRows.length) {
    throw new Error(
      `Frequency-detail verification mismatch: ${checks.rows[0].frequency_details} vs ${frequencyDetailRows.length}`
    );
  }

  const openBodyViolations = await client.query(`
    SELECT cutter_body_id, COUNT(*)::int AS open_count
    FROM cutter_builds b
    WHERE b.build_number = ANY($1::text[])
      AND b.completed_at IS NULL
    GROUP BY cutter_body_id
    HAVING COUNT(*) > 1
  `, [sourceBuilds.map((x) => x.buildNumber)]);

  if (openBodyViolations.rowCount > 0) {
    throw new Error(`Open-build verification failed: ${JSON.stringify(openBodyViolations.rows)}`);
  }

  const activeMachineViolations = await client.query(`
    SELECT machine_id, COUNT(*)::int AS active_count
    FROM cutter_machine_runs r
    JOIN cutter_builds b ON b.id = r.cutter_build_id
    WHERE b.build_number = ANY($1::text[])
      AND r.removed_at IS NULL
      AND r.enabled = true
    GROUP BY machine_id
    HAVING COUNT(*) > 1
  `, [sourceBuilds.map((x) => x.buildNumber)]);

  if (activeMachineViolations.rowCount > 0) {
    throw new Error(
      `Active-machine verification failed: ${JSON.stringify(activeMachineViolations.rows)}`
    );
  }

  const orphanChecks = await client.query(`
    SELECT
      (SELECT COUNT(*)::int
       FROM cutter_events e
       LEFT JOIN cutter_builds b ON b.id=e.cutter_build_id
       WHERE b.id IS NULL) AS orphan_events,
      (SELECT COUNT(*)::int
       FROM cutter_frequency_checks f
       LEFT JOIN cutter_events e ON e.id=f.event_id
       WHERE e.id IS NULL) AS orphan_frequency_checks,
      (SELECT COUNT(*)::int
       FROM cutter_machine_runs r
       LEFT JOIN cutter_builds b ON b.id=r.cutter_build_id
       WHERE b.id IS NULL) AS orphan_machine_runs,
      (SELECT COUNT(*)::int
       FROM cutter_builds b
       LEFT JOIN cutter_bodies cb ON cb.id=b.cutter_body_id
       WHERE cb.id IS NULL) AS orphan_build_bodies
  `);

  const orphanRow = orphanChecks.rows[0];
  if (Object.values(orphanRow).some((v) => Number(v) !== 0)) {
    throw new Error(`Post-refresh orphan verification failed: ${JSON.stringify(orphanRow)}`);
  }

  await client.query('COMMIT');

  progress('COMMIT complete');

  report.committed = {
    integrity_verified: true,
    migrated_builds: checks.rows[0].builds,
    migrated_events: checks.rows[0].events,
    frequency_details: checks.rows[0].frequency_details,
    current_running: checks.rows[0].running,
    historical_closed: report.planned.historical_closed,
    current_available: report.planned.current_available,
  };
  fs.writeFileSync(migrationReportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n[PASS] DYNAMIC FULL REFRESH COMMITTED');
  console.log({
    migrated_builds: checks.rows[0].builds,
    migrated_events: checks.rows[0].events,
    frequency_details: checks.rows[0].frequency_details,
    current_running: checks.rows[0].running,
    historical_closed: report.planned.historical_closed,
    current_available: report.planned.current_available,
  });
} catch (error) {
  await client.query('ROLLBACK');
  console.error('\n[ROLLBACK] No partial cutter-history migration was committed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
