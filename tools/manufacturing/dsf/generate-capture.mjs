import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Audited source identities, not a physical-machine count or a plant allowlist. */
export const DEFAULT_SOURCES = Object.freeze([
  { name: 'CutGrind 6 1-24-77', sourceId: '666e2c9a-545e-4ce0-b9f2-eb5c8c579c5c', opId: '5212149b-76d3-48be-97eb-138376036024', lineId: '0aab0c6e-4456-46b9-9a0b-4de7d0a57e07' },
  { name: 'CutGrind 4 1-24-78', sourceId: 'dd21c21b-a57e-4d61-afcb-c2749480e3f9', opId: 'cafd4e72-bc71-426d-a726-6c6f40f1788b', lineId: 'dca4597f-4de0-4324-97ac-42b215843791' },
  { name: 'CutGrind 3 1-24-79', sourceId: '1d6e8617-c497-45ca-8cc7-af92f4556b43', opId: 'ca94b716-ff99-426a-b63c-c79e49c5692e', lineId: '5e7b362f-2cb5-4491-904e-2e1f107cc97e', whiteboardId: '9b176c57-b77a-4dd7-b1be-28bb75b7c9e6' },
  { name: 'CutGrind 7 1-24-80', sourceId: 'b6c0d002-871b-4561-8346-1e7a25865193', opId: 'b86d1e5c-da15-41fd-9dfc-2e1ee92867fb', lineId: 'a7e3f04c-f35a-4811-b749-2343561708aa' },
  { name: 'CutGrind 5 1-24-81', sourceId: '4ef46158-f861-4ea3-828e-5a07710a80c0', opId: '07635887-57de-47ae-9c69-6a3856bda303', lineId: '7aa4c439-39cc-4a25-85db-553ba667bbca' },
  { name: '181 - 1', sourceId: 'c40b52fb-6f80-450c-897d-d61ce5539aac', opId: 'c13a1365-8420-419e-857c-445f5df82fb3', lineId: 'c6429cd9-64b3-4ea3-9f9d-fd291612488e', whiteboardId: 'e7fb8890-3071-4aa9-9746-cb038a4d3fc0' },
].map(Object.freeze));

export const DEFAULT_WINDOW = Object.freeze({
  start: '2026-11-11T15:00:00-05:00',
  end: '2026-11-11T23:00:00-05:00',
  cutoff: '2026-11-11T21:56:23-05:00',
  timezone: 'America/Indiana/Indianapolis',
});

const MARKER = 'DSF_CAPTURE_COMPLETED_READ_ONLY_V1';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Window timestamps must be ISO 8601 with an explicit UTC offset.');
  }
  return new Date(value).toISOString();
};
function options(input = {}) {
  const sources = input.sources ?? DEFAULT_SOURCES;
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 25) throw new Error('Select 1–25 detailed sources.');
  const ids = new Set();
  for (const source of sources) {
    if (!source || ![source.sourceId, source.opId, source.lineId].every(x => typeof x === 'string' && uuid.test(x)) ||
        (source.whiteboardId != null && (typeof source.whiteboardId !== 'string' || !uuid.test(source.whiteboardId))) ||
        typeof source.name !== 'string' || !source.name.trim() || /[\r\n\0]/.test(source.name) || source.name.length > 150 || ids.has(source.sourceId.toLowerCase())) {
      throw new Error('Sources require unique UUID sourceId, UUID opId, UUID lineId and a bounded single-line name.');
    }
    ids.add(source.sourceId.toLowerCase());
  }
  const window = { ...DEFAULT_WINDOW, ...input.window };
  const start = time(window.start), end = time(window.end), cutoff = time(window.cutoff);
  if (!(start < cutoff && cutoff <= end) || Date.parse(end) - Date.parse(start) > 172800000) throw new Error('Use start < cutoff <= end and a window no longer than 48 hours.');
  try { new Intl.DateTimeFormat('en', { timeZone: window.timezone }).format(); } catch { throw new Error('Use a valid IANA display timezone.'); }
  const bounded = (name, fallback, max) => {
    const value = input[name] ?? fallback;
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}.`);
    return value;
  };
  return { sources: sources.map(({ name, sourceId, opId, lineId, whiteboardId }) => ({ name, sourceId: sourceId.toLowerCase(), opId: opId.toLowerCase(), lineId: lineId.toLowerCase(), whiteboardId: whiteboardId?.toLowerCase() ?? null })), window: { start, end, cutoff, timezone: window.timezone }, rowLimit: bounded('rowLimit', 10000, 10000), inventoryLimit: bounded('inventoryLimit', 5000, 10000), catalogLimit: bounded('catalogLimit', 10000, 20000) };
}

const requiredCore = {
  tbl_whiteboard_machines: ['id', 'whiteboard_id', 'op_id', 'line_id', 'active'],
  tbl_whiteboard: ['id', 'name', 'active'],
  tbl_op: ['id', 'name', 'line_id', 'asset_number'],
  tbl_line: ['id', 'name', 'department_id', 'loc_id', 'area_id', 'cell_id', 'asset_number'],
  tbl_department: ['id', 'name'],
};
const relations = [
  ...Object.keys(requiredCore), 'operation_detail', 'tbl_location', 'tbl_area', 'tbl_cell', 'tbl_plant',
  'tbl_location_config', 'tbl_threshold_color', 'tbl_whiteboard_comment_shift', 'tbl_whiteboard_comment', 'tbl_whiteboard_cycles_master', 'tbl_whiteboard_cycles',
  'tbl_whiteboard_cycles_current', 'tbl_whiteboard_cycles_old', 'tbl_whiteboard_daily_aggregate',
  'tbl_op_state', 'tbl_line_state', 'tbl_op_state_reason', 'tbl_line_state_reason', 'tbl_op_state_category',
  'tbl_op_rated_speed', 'tbl_line_rated_speed', 'tbl_op_cycle_time', 'tbl_line_cycle_time', 'tbl_op_cycle_bounds',
  'tbl_op_count_target', 'tbl_line_count_target', 'tbl_line_daily_target', 'tbl_op_count_rework', 'tbl_line_count_rework',
  'tbl_op_oee', 'tbl_line_oee', 'tbl_shift', 'tbl_shift_schedule', 'vw_oa_state_data',
];
const relevant = `n.nspname='public' AND (c.relname IN (${relations.map(quote).join(',')}) OR c.relname ~* '(part|config|comment|threshold|shift)')`;
const core = `chosen AS (
 SELECT * FROM jsonb_to_recordset(__DSF_SOURCE_JSON__::jsonb) AS x(name text, "sourceId" uuid, "opId" uuid, "lineId" uuid, "whiteboardId" uuid)
), resolved AS (
 SELECT s.name,s."sourceId" AS source_id,s."opId" AS op_id,s."lineId" AS line_id,s."whiteboardId" AS expected_whiteboard_id,
   wm.whiteboard_id,w.name AS current_name,wm.op_id AS current_op_id,wm.line_id AS current_line_id,
   o.line_id AS operation_line_id,l.name AS line_name,wm.active AS mapping_active,w.active AS whiteboard_active,
   CASE WHEN wm.id IS NULL THEN 'missing_source'
        WHEN w.id IS NULL OR o.id IS NULL OR l.id IS NULL OR d.id IS NULL THEN 'missing_related_identity'
        WHEN wm.op_id IS DISTINCT FROM s."opId" OR wm.line_id IS DISTINCT FROM s."lineId"
          OR (s."whiteboardId" IS NOT NULL AND wm.whiteboard_id IS DISTINCT FROM s."whiteboardId")
          OR o.line_id IS DISTINCT FROM s."lineId" OR w.name IS DISTINCT FROM s.name THEN 'identity_mismatch'
        WHEN wm.active IS DISTINCT FROM true OR w.active IS DISTINCT FROM true THEN 'inactive_source'
        ELSE 'validated' END AS identity_status
 FROM chosen s LEFT JOIN public.tbl_whiteboard_machines wm ON wm.id=s."sourceId"
 LEFT JOIN public.tbl_whiteboard w ON w.id=wm.whiteboard_id
 LEFT JOIN public.tbl_op o ON o.id=wm.op_id LEFT JOIN public.tbl_line l ON l.id=wm.line_id
 LEFT JOIN public.tbl_department d ON d.id=l.department_id
)`;

function schemaCheck(required) {
  const pairs = Object.entries(required).flatMap(([table, cols]) => cols.map(column => `(${quote(table)},${quote(column)})`));
  return `SELECT NOT EXISTS (
 SELECT 1 FROM (VALUES ${pairs.join(',')}) expected(relation,column_name)
 WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='public' AND c.relname=expected.relation AND c.relkind IN ('r','p','v','m','f')
     AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped)
) AS dsf_schema_ok
\\gset`;
}

/** One JSON object per dataset/source; even a zero-row result has a manifest. */
function selectedDataset(name, required, query, limit, note = '') {
  return `\n-- ${name}: ${note || 'Selected validated sources only.'}
${schemaCheck(required)}
\\if :dsf_schema_ok
WITH ${core}
SELECT jsonb_build_object('kind','DATASET','dataset',${quote(name)},'source',v.name,'source_id',v.source_id,
 'manifest',jsonb_build_object('identity_status',v.identity_status,
   'status',CASE WHEN v.identity_status<>'validated' THEN v.identity_status WHEN d.observed_rows>${limit} THEN 'truncated' ELSE 'complete' END,
   'returned_rows',LEAST(d.observed_rows,${limit}),'observed_rows',d.observed_rows,'row_limit',${limit},
   'truncated',d.observed_rows>${limit},'scope','selected_sources','note',${quote(note)}),
 'records',d.records)
FROM resolved v CROSS JOIN LATERAL (
 SELECT count(*) AS observed_rows,COALESCE(jsonb_agg(b.record ORDER BY b.ordinal) FILTER (WHERE b.ordinal<=${limit}),'[]'::jsonb) AS records
 FROM (SELECT to_jsonb(q) AS record,row_number() OVER () AS ordinal FROM (
${query}
 LIMIT ${limit + 1}
 ) q) b
) d ORDER BY v.name,v.source_id;
\\else
WITH ${core}
SELECT jsonb_build_object('kind','DATASET','dataset',${quote(name)},'source',name,'source_id',source_id,
 'manifest',jsonb_build_object('status','unavailable_schema','identity_status',identity_status,
 'returned_rows',0,'observed_rows',0,'row_limit',${limit},'truncated',false,'scope','selected_sources','note',${quote(note)}),'records','[]'::jsonb)
FROM resolved ORDER BY name,source_id;
\\endif\n`;
}

function globalDataset(name, query, limit, note) {
  return `\n-- ${name}
WITH bounded AS MATERIALIZED (${query}\n LIMIT ${limit + 1}),
numbered AS (SELECT to_jsonb(b) record,row_number() OVER () ordinal FROM bounded b)
SELECT jsonb_build_object('kind','DATASET','dataset',${quote(name)},
 'manifest',jsonb_build_object('status',CASE WHEN count(*)>${limit} THEN 'truncated' ELSE 'complete' END,
 'returned_rows',LEAST(count(*),${limit}),'observed_rows',count(*),'row_limit',${limit},'truncated',count(*)>${limit},'note',${quote(note)}),
 'records',COALESCE(jsonb_agg(record ORDER BY ordinal) FILTER (WHERE ordinal<=${limit}),'[]'::jsonb)) FROM numbered;\n`;
}

export function buildCaptureSql(input = {}) {
  const config = options(input), { rowLimit, inventoryLimit, catalogLimit } = config;
  const plannedDatasets = [];
  const global = (name, ...args) => {
    plannedDatasets.push({ dataset: name, scope: 'global', expected_manifests: 1 });
    return globalDataset(name, ...args);
  };
  const { start, end, cutoff, timezone } = config.window;
  const from = `TIMESTAMPTZ ${quote(start)}`, until = `TIMESTAMPTZ ${quote(cutoff)}`;
  let sql = `-- Generated by generate-capture.mjs. No credential values, helper objects or plant writes.
-- Whole-plant mapping inventory; detailed history ONLY for the selected sources.
-- Timestamp ties are retained within explicit caps. Completion is not business parity.
\\set ON_ERROR_STOP on
\\pset pager off
\\pset format unaligned
\\pset tuples_only on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='1s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL standard_conforming_strings=on;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL max_parallel_workers_per_gather=0;
SET LOCAL jit=off;
SET LOCAL standard_conforming_strings=on;
SELECT jsonb_build_object('kind','CAPTURE_HEADER','version',1,'database',current_database(),
 'snapshot_at',transaction_timestamp(),'server_clock_at_start',clock_timestamp(),
 'server_version',current_setting('server_version'),'session_timezone',current_setting('TimeZone'),
 'transaction_isolation',current_setting('transaction_isolation'),'transaction_read_only',current_setting('transaction_read_only'),
 'window',jsonb_build_object('start_utc',${from},'end_utc',TIMESTAMPTZ ${quote(end)},'cutoff_utc',${until},
   'timezone',${quote(timezone)},'start_local',${from} AT TIME ZONE ${quote(timezone)},
   'end_local',TIMESTAMPTZ ${quote(end)} AT TIME ZONE ${quote(timezone)},'cutoff_local',${until} AT TIME ZONE ${quote(timezone)},
   'boundary','[start,cutoff)','requested_elapsed_seconds',extract(epoch FROM (${until}-${from}))),
 'coverage',jsonb_build_object('inventory','all public DSF mappings; no numeric-department filter',
   'detailed_source_count',${config.sources.length},'detailed_sources',__DSF_SOURCE_JSON__::jsonb,
   'full_plant_history',false,'historical_mutability','current snapshot may include corrections made after the report cutoff'),
 'audited_relation_allowlist',${quote(JSON.stringify(relations))}::jsonb,
 'planned_datasets',__DSF_PLANNED_DATASETS__::jsonb,'expected_source_validations',${config.sources.length},
 'expected_dataset_manifests',__DSF_EXPECTED_MANIFESTS__,'business_parity_verified',false);
`;
  sql += global('RELATION_CATALOG', `SELECT n.nspname AS schema,c.relname AS relation,c.relkind,
 c.relispartition,c.reltuples::bigint AS estimated_rows,
 CASE WHEN c.relname IN (${relations.map(quote).join(',')}) THEN 'audited_relation' ELSE 'candidate_metadata_only' END AS capture_policy
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE ${relevant} AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname`, catalogLimit, 'Estimates are not exact row counts; unknown part/config/comment relations have metadata only.');
  sql += global('COLUMN_CATALOG', `SELECT n.nspname AS schema,c.relname AS relation,a.attname AS column,
 pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
 pg_catalog.col_description(c.oid,a.attnum) AS schema_comment
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE ${relevant} AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname,a.attnum`, catalogLimit, 'Column metadata, not row values.');
  sql += global('CONSTRAINT_CATALOG', `SELECT n.nspname AS schema,c.relname AS relation,k.conname AS name,k.contype AS type,
 pg_catalog.pg_get_constraintdef(k.oid,true) AS definition
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid WHERE ${relevant} ORDER BY c.relname,k.conname`, catalogLimit, 'Confirm foreign-key relations instead of inferring them from names.');
  sql += global('INDEX_CATALOG', `SELECT n.nspname AS schema,c.relname AS relation,i.relname AS index,
 ix.indisvalid,ix.indisready,pg_catalog.pg_get_indexdef(i.oid) AS definition
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_index ix ON ix.indrelid=c.oid JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid
 WHERE ${relevant} ORDER BY c.relname,i.relname`, catalogLimit, 'No EXPLAIN ANALYZE or full-table counts are executed.');
  sql += global('BUSINESS_VIEW_DEFINITIONS', `SELECT n.nspname AS schema,c.relname AS relation,
 pg_catalog.pg_get_viewdef(c.oid,true) AS definition
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('operation_detail','vw_oa_state_data','tbl_whiteboard_cycles_master','tbl_whiteboard_cycles','tbl_whiteboard_cycles_current','tbl_whiteboard_cycles_old')
 AND c.relkind IN ('v','m') ORDER BY c.relname`, catalogLimit, 'Definitions restricted to the audited business views; no function bodies are exported.');
  sql += global('PARTITION_CATALOG', `SELECT pn.nspname AS parent_schema,p.relname AS parent,
 cn.nspname AS child_schema,c.relname AS child,pg_catalog.pg_get_expr(c.relpartbound,c.oid,true) AS partition_bound
 FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class p ON p.oid=i.inhparent
 JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace JOIN pg_catalog.pg_class c ON c.oid=i.inhrelid
 JOIN pg_catalog.pg_namespace cn ON cn.oid=c.relnamespace
 WHERE pn.nspname='public' AND (p.relname ~ '^tbl_(whiteboard_cycles|op_|line_)' OR c.relname ~ '^tbl_(whiteboard_cycles|op_|line_)')
 ORDER BY p.relname,c.relname`, catalogLimit, 'Partition/inheritance structure; partition bounds can expose coverage without scanning history.');
  sql += `${schemaCheck(requiredCore)}
\\if :dsf_schema_ok
`;
  sql += global('ALL_PLANT_SOURCE_INVENTORY', `SELECT wm.id AS source_id,wm.whiteboard_id,w.name AS whiteboard_name,
 wm.op_id,o.name AS operation_name,o.asset_number AS operation_asset_number,o.line_id AS operation_line_id,
 wm.line_id,l.name AS line_name,l.asset_number AS line_asset_number,l.department_id,d.name AS department_name,
 l.loc_id AS location_id,l.area_id,l.cell_id,wm.active AS mapping_active,w.active AS whiteboard_active,
 o.line_id=wm.line_id AS operation_line_matches,
 (count(*) FILTER (WHERE wm.active AND w.active) OVER (PARTITION BY wm.op_id)) AS both_active_mappings_for_operation
 FROM public.tbl_whiteboard_machines wm LEFT JOIN public.tbl_whiteboard w ON w.id=wm.whiteboard_id
 LEFT JOIN public.tbl_op o ON o.id=wm.op_id LEFT JOIN public.tbl_line l ON l.id=wm.line_id
 LEFT JOIN public.tbl_department d ON d.id=l.department_id
 ORDER BY d.name NULLS LAST,l.name NULLS LAST,w.name NULLS LAST,wm.id`, inventoryLimit, 'Includes inactive aliases and named departments. Source mappings/operations are not physical-machine counts.');
  sql += global('ALL_PLANT_DEPARTMENTS', 'SELECT id,name FROM public.tbl_department ORDER BY name,id', inventoryLimit, 'Includes departments with no whiteboard mapping; preserve raw names and UUIDs.');
  sql += global('ALL_PLANT_LINES', `SELECT id,name,asset_number,department_id,loc_id AS location_id,area_id,cell_id
 FROM public.tbl_line ORDER BY name,id`, inventoryLimit, 'Includes lines without whiteboard mappings; asset numbers are DSF identifiers, not verified physical-machine matches.');
  sql += global('ALL_PLANT_OPERATIONS', `SELECT id,name,asset_number,line_id FROM public.tbl_op ORDER BY name,id`, inventoryLimit, 'Includes operations without whiteboard mappings; do not silently equate operations with physical machines.');
  const hierarchyFields = ['operation_id','operation_name','line_segment_id','line_segment_name','line_id','line_name','department_id','department_name','area_id','area_name','plant_id','plant_name','downtime_upper','downtime_lower','ftt_upper','ftt_lower','oee_upper','oee_lower'];
  sql += `${schemaCheck({ operation_detail: hierarchyFields })}\n\\if :dsf_schema_ok\n`;
  sql += global('ALL_PLANT_OPERATION_HIERARCHY', `SELECT ${hierarchyFields.join(',')} FROM public.operation_detail ORDER BY plant_id,department_id,line_id,operation_id,line_segment_id`, inventoryLimit, 'Hierarchy and thresholds for all operations, including named departments; current configuration only.');
  sql += `\\else
SELECT jsonb_build_object('kind','DATASET','dataset','ALL_PLANT_OPERATION_HIERARCHY','manifest',jsonb_build_object('status','unavailable_schema','returned_rows',0,'observed_rows',0,'row_limit',${inventoryLimit},'truncated',false),'records','[]'::jsonb);
\\endif\n`;
  sql += `WITH ${core}
SELECT jsonb_build_object('kind','SOURCE_VALIDATION','source',name,'source_id',source_id,
 'manifest',jsonb_build_object('status',identity_status),
 'expected',jsonb_build_object('op_id',op_id,'line_id',line_id,'whiteboard_name',name,'whiteboard_id',expected_whiteboard_id,'whiteboard_id_previously_verified',expected_whiteboard_id IS NOT NULL),
 'current',jsonb_build_object('op_id',current_op_id,'line_id',current_line_id,'operation_line_id',operation_line_id,
 'whiteboard_id',whiteboard_id,'whiteboard_name',current_name,'mapping_active',mapping_active,'whiteboard_active',whiteboard_active))
FROM resolved ORDER BY name,source_id;\n`;

  const detail = (name, required, query, note = '') => {
    plannedDatasets.push({ dataset: name, scope: 'selected_sources', expected_manifests: config.sources.length });
    sql += selectedDataset(name, required, query, rowLimit, note);
  };
  const stream = (table, owner, fields, extraRequired = {}, selectExtra = '', joins = '') => {
    const columns = ['id', owner, 'timestamp', ...fields];
    const required = { [table]: columns, ...extraRequired };
    const projection = columns.map(c => `r.${c === 'timestamp' ? '"timestamp"' : c}`).join(',') + selectExtra;
    const base = ` SELECT ${projection} FROM public.${table} r${joins ? ' ' + joins : ''}\n WHERE v.identity_status='validated' AND r.${owner}=v.${owner}`;
    detail(`${table.toUpperCase()}_WINDOW`, required, `${base} AND r."timestamp">=${from} AND r."timestamp"<${until}\n ORDER BY r."timestamp",r.id`, 'Raw stream; no production/downtime formula inferred.');
    for (const [suffix, operator, aggregate, boundary] of [['PREDECESSOR', '<', 'max', from], ['SUCCESSOR', '>=', 'min', until]]) {
      detail(`${table.toUpperCase()}_${suffix}`, required,
        `${base} AND r."timestamp"=(SELECT ${aggregate}(edge."timestamp") FROM public.${table} edge\n WHERE edge.${owner}=v.${owner} AND edge."timestamp"${operator}${boundary})\n ORDER BY r."timestamp",r.id`,
        'All rows at the nearest boundary timestamp, subject to the explicit cap; ties are not silently reduced to one row.');
    }
  };
  const events = { tbl_whiteboard_cycles_master: ['id','machine_id','whiteboard_id','code','length','timestamp','part_count'] };
  const eventBase = ` SELECT r.id,r.machine_id,r.whiteboard_id,r.code AS reason_id,r.length,r."timestamp",r.part_count
 FROM public.tbl_whiteboard_cycles_master r
 WHERE v.identity_status='validated' AND r.machine_id=v.source_id AND r.whiteboard_id=v.whiteboard_id`;
  detail('WHITEBOARD_EVENTS_WINDOW', events, `${eventBase} AND r."timestamp">=${from} AND r."timestamp"<${until}\n ORDER BY r."timestamp",r.id`, 'code is a reason-row ID; join the separately captured dictionary by ID and operation. Do not sum every part_count.');
  for (const [suffix, operator, aggregate, boundary] of [['PREDECESSOR','<','max',from],['SUCCESSOR','>=','min',until]]) {
    detail(`WHITEBOARD_EVENTS_${suffix}`, events, `${eventBase} AND r."timestamp"=(SELECT ${aggregate}(e."timestamp") FROM public.tbl_whiteboard_cycles_master e
 WHERE e.machine_id=v.source_id AND e.whiteboard_id=v.whiteboard_id AND e."timestamp"${operator}${boundary})\n ORDER BY r."timestamp",r.id`, 'Boundary context may be outside the requested report window; do not add it directly to report totals.');
  }
  for (const [prefix, owner] of [['op','op_id'],['line','line_id']]) {
    stream(`tbl_${prefix}_state`, owner, ['code','length']);
    stream(`tbl_${prefix}_rated_speed`, owner, prefix === 'op' ? ['rated_speed','part_count'] : ['rated_speed']);
    const currentRate = `tbl_${prefix}_rated_speed`;
    const currentRateFields = ['id',owner,'rated_speed','timestamp',...(prefix === 'op' ? ['part_count'] : [])];
    detail(`${currentRate.toUpperCase()}_CURRENT_AS_OF_CAPTURE`, { [currentRate]: currentRateFields },
      ` SELECT ${currentRateFields.map(c => `r.${c === 'timestamp' ? '"timestamp"' : c}`).join(',')}
 FROM public.${currentRate} r WHERE v.identity_status='validated' AND r.${owner}=v.${owner}
 AND r."timestamp"=(SELECT max(latest."timestamp") FROM public.${currentRate} latest
 WHERE latest.${owner}=v.${owner} AND latest."timestamp"<=transaction_timestamp())\n ORDER BY r."timestamp",r.id`,
      'Latest standard at capture time with timestamp ties; historical cycles still use their explicitly referenced rate rows.');
    stream(`tbl_${prefix}_count_target`, owner, ['count']);
    stream(`tbl_${prefix}_count_rework`, owner, ['count','reason','length']);
    stream(`tbl_${prefix}_oee`, owner, ['oee','oee_availability','oee_performance','oee_quality']);
    const rate = `tbl_${prefix}_rated_speed`, cycle = `tbl_${prefix}_cycle_time`;
    stream(cycle, owner, ['cycle_time','rated_speed'], { [rate]: ['id',owner,'rated_speed','timestamp',...(prefix === 'op' ? ['part_count'] : [])] },
      `,standard.id AS referenced_standard_id,standard.rated_speed AS referenced_standard_value,standard."timestamp" AS referenced_standard_effective_at${prefix === 'op' ? ',standard.part_count AS referenced_standard_part_count' : ''}`,
      `LEFT JOIN public.${rate} standard ON standard.id=r.rated_speed AND standard.${owner}=r.${owner}`);
    const reason = `tbl_${prefix}_state_reason`;
    const fields = ['id',owner,'code','name','color','active','timestamp',...(prefix === 'op' ? ['running','downtime','fttloss','category_id'] : [])];
    detail(`${reason.toUpperCase()}_DICTIONARY`, { [reason]: fields }, ` SELECT ${fields.map(c => `r.${c === 'timestamp' ? '"timestamp"' : c}`).join(',')}
 FROM public.${reason} r WHERE v.identity_status='validated' AND r.${owner}=v.${owner}\n ORDER BY r.id`, 'Includes inactive historical reasons. Business code is not a unique join key.');
  }
  detail('OPERATION_HIERARCHY_AND_THRESHOLDS', { operation_detail: ['operation_id','operation_name','line_segment_id','line_segment_name','line_id','line_name','department_id','department_name','area_id','area_name','plant_id','plant_name','downtime_upper','downtime_lower','ftt_upper','ftt_lower','oee_upper','oee_lower'] },
    ` SELECT r.operation_id,r.operation_name,r.line_segment_id,r.line_segment_name,r.line_id,r.line_name,r.department_id,r.department_name,
 r.area_id,r.area_name,r.plant_id,r.plant_name,r.downtime_upper,r.downtime_lower,r.ftt_upper,r.ftt_lower,r.oee_upper,r.oee_lower
 FROM public.operation_detail r WHERE v.identity_status='validated' AND r.operation_id=v.op_id\n ORDER BY r.operation_id,r.line_segment_id`, 'Current hierarchy/configuration, not certified historical configuration.');
  detail('SHIFT_INTERVALS_NEAR_WINDOW', { tbl_shift: ['id','line_id','shift','start_of_day','start_time','end_time','timestamp'] },
    ` SELECT r.id,r.line_id,r.shift,r.start_of_day,r.start_time,r.end_time,r."timestamp"
 FROM public.tbl_shift r WHERE v.identity_status='validated' AND r.line_id=v.line_id
 AND r.start_time<TIMESTAMPTZ ${quote(end)}+interval '1 day' AND r.end_time>${from}-interval '1 day'
 ORDER BY r.start_time,r.id`, 'Stored timestamptz boundaries are authoritative evidence. Neighboring shifts support business-day and DST review.');
  detail('SHIFT_SCHEDULE_CONFIGURATION', { tbl_shift_schedule: ['id','line_id','shift','start_of_day','start_time','end_time','timestamp'] },
    ` SELECT r.id,r.line_id,r.shift,r.start_of_day,r.start_time,r.end_time,r."timestamp"
 FROM public.tbl_shift_schedule r WHERE v.identity_status='validated' AND r.line_id=v.line_id\n ORDER BY r."timestamp",r.id`, 'Text schedule times do not themselves resolve DST folds or gaps. Current configuration may differ from historical shifts.');
  detail('LINE_DAILY_TARGETS_NEAR_WINDOW', { tbl_line_daily_target: ['id','line_name','target','timestamp'] },
    ` SELECT r.id,r.line_name,r.target,r."timestamp" FROM public.tbl_line_daily_target r
 WHERE v.identity_status='validated' AND r.line_name=v.line_name AND r."timestamp">=${from}-interval '1 day'
 AND r."timestamp"<TIMESTAMPTZ ${quote(end)}+interval '1 day'\n ORDER BY r."timestamp",r.id`, 'Name-based association is retained explicitly; duplicates/renames require reconciliation. Target is not assumed to be maximum capacity.');
  detail('WHITEBOARD_DAILY_AGGREGATES_NEAR_WINDOW', { tbl_whiteboard_daily_aggregate: ['id','whiteboard_id','actual','target','rework','code','length','timestamp'] },
    ` SELECT r.id,r.whiteboard_id,r.actual,r.target,r.rework,r.code,r.length,r."timestamp"
 FROM public.tbl_whiteboard_daily_aggregate r WHERE v.identity_status='validated' AND r.whiteboard_id=v.whiteboard_id
 AND r."timestamp">=(${from} AT TIME ZONE ${quote(timezone)})::date-1
 AND r."timestamp"<= (TIMESTAMPTZ ${quote(end)} AT TIME ZONE ${quote(timezone)})::date+1\n ORDER BY r."timestamp",r.id`, 'Date aggregates may contain the full day after the screenshot cutoff; reconcile rather than adding to event totals.');
  // Part names are manufacturing context. Serial/workstation/operator fields are excluded.
  detail('OP_CYCLE_BOUNDS_OVERLAPPING_WINDOW', { tbl_op_cycle_bounds: ['id','op_id','cycle_start','cycle_end','part'] },
    ` SELECT r.id,r.op_id,r.cycle_start,r.cycle_end,r.part FROM public.tbl_op_cycle_bounds r
 WHERE v.identity_status='validated' AND r.op_id=v.op_id AND r.cycle_start<${until}
 AND (r.cycle_end>=${from} OR r.cycle_end IS NULL)\n ORDER BY r.cycle_start,r.id`, 'Cycle intervals and part names only; serial is excluded. Open cycles may extend beyond the historical cutoff.');
  detail('WHITEBOARD_SHIFT_COMMENTS', {
    tbl_whiteboard_comment_shift: ['id','whiteboard_id','shift_id','comment','timestamp','is_deleted','modified_on','edited_comment_id'],
    tbl_shift: ['id','line_id','start_time','end_time'],
  }, ` SELECT r.id,r.whiteboard_id,r.shift_id,r.comment,r."timestamp",r.is_deleted,r.modified_on,r.edited_comment_id
 FROM public.tbl_whiteboard_comment_shift r JOIN public.tbl_shift sh ON sh.id=r.shift_id
 WHERE v.identity_status='validated' AND r.whiteboard_id=v.whiteboard_id AND sh.line_id=v.line_id
 AND sh.start_time<TIMESTAMPTZ ${quote(end)} AND sh.end_time>${from}\n ORDER BY r."timestamp",r.id`,
    'Selected report-shift comments, including edit/deletion markers; excludes user, IP and hostname columns. Free text can contain operator-entered information; inspect locally before sharing.');
  sql += `${schemaCheck({ tbl_op_state_category: ['id','name','display_name'] })}
\\if :dsf_schema_ok
` + global('REASON_CATEGORIES', 'SELECT id,name,display_name FROM public.tbl_op_state_category ORDER BY id', inventoryLimit, 'State-reason category dictionary.') + `\\else
SELECT jsonb_build_object('kind','DATASET','dataset','REASON_CATEGORIES','manifest',jsonb_build_object('status','unavailable_schema','returned_rows',0,'observed_rows',0,'row_limit',${inventoryLimit},'truncated',false),'records','[]'::jsonb);
\\endif
\\else
SELECT jsonb_build_object('kind','CAPTURE_ERROR','code','CORE_SCHEMA_UNAVAILABLE','message','Required mapping/hierarchy schema differs; catalog captured, detailed queries suppressed.');
ROLLBACK;
-- psql versions that ignore a numeric \\quit argument still fail under ON_ERROR_STOP.
SELECT 1/0 AS dsf_core_schema_unavailable;
\\quit
\\endif
ROLLBACK;
SELECT jsonb_build_object('kind','CAPTURE_COMPLETED','marker',${quote(MARKER)},'transaction_finished','rolled_back',
 'planned_datasets',__DSF_PLANNED_DATASETS__::jsonb,'expected_source_validations',${config.sources.length},
 'expected_dataset_manifests',__DSF_EXPECTED_MANIFESTS__,
 'business_parity_verified',false,'full_plant_history',false,
 'limitations',jsonb_build_array('Check every manifest for truncation, unavailable schema and source identity failures.',
 'Only selected source histories were captured; whole-plant inventory does not establish physical-machine completeness.',
 'Historical configuration and event corrections may differ from the original screenshot.',
 'Timestamp semantics, production attribution, capacity rounding, downtime, cycle variance, FTT and the upper donut metric require formula verification.',
 'Unknown part/config/comment relations are metadata-only; selected shift comments and cycle-bound part names use explicit projections. No serial/workstation/user columns or function bodies were exported.'));
`;
  const substitutions = {
    __DSF_SOURCE_JSON__: quote(JSON.stringify(config.sources)),
    __DSF_PLANNED_DATASETS__: quote(JSON.stringify(plannedDatasets)),
    __DSF_EXPECTED_MANIFESTS__: String(plannedDatasets.reduce((sum, entry) => sum + entry.expected_manifests, 0)),
  };
  // Substitute once: a source display name may itself contain a marker's text.
  return sql.replace(/__DSF_(?:SOURCE_JSON|PLANNED_DATASETS|EXPECTED_MANIFESTS)__/g, key => substitutions[key]);
}

export function buildPowerShell(input = {}) {
  const sql = buildCaptureSql(input);
  return `# Generated by generate-capture.mjs. Paste this complete file into PowerShell or run it as a script.
# It prompts for connection settings and the password; it does not store credentials.
& {
    $ErrorActionPreference = 'Stop'
    $dsfSqlPath = $null
    $dsfReportPath = $null
    $dsfPreviousConnectTimeout = $env:PGCONNECT_TIMEOUT
    $dsfPreviousEncoding = $env:PGCLIENTENCODING
    try {
        $dsfPsqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
        if (-not $dsfPsqlCommand) { $dsfPsqlCommand = Get-Command psql -ErrorAction SilentlyContinue }
        $dsfPsqlPath = if ($dsfPsqlCommand) { $dsfPsqlCommand.Source } else { $null }
        if (-not $dsfPsqlPath) {
            $dsfPsqlCandidates = @(Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles 'PostgreSQL') -Filter psql.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
            if ($dsfPsqlCandidates.Count -gt 0) { $dsfPsqlPath = $dsfPsqlCandidates[0].FullName }
        }
        if (-not $dsfPsqlPath) { $dsfPsqlPath = (Read-Host 'Full path to psql.exe').Trim().Trim('"') }
        if (-not (Test-Path -LiteralPath $dsfPsqlPath -PathType Leaf)) { throw 'psql was not found. Install the PostgreSQL command-line client, then run again.' }
        $dsfServer = (Read-Host 'DSF PostgreSQL host (use the same server as MeshForge)').Trim()
        if (-not $dsfServer) { throw 'A server name is required.' }
        $dsfPortText = (Read-Host 'PostgreSQL port [5432]').Trim()
        if (-not $dsfPortText) { $dsfPortText = '5432' }
        $dsfPortNumber = 0
        if (-not [int]::TryParse($dsfPortText, [ref]$dsfPortNumber) -or $dsfPortNumber -lt 1 -or $dsfPortNumber -gt 65535) { throw 'Port must be from 1 to 65535.' }
        $dsfLogin = (Read-Host 'DSF read-only PostgreSQL username').Trim()
        if (-not $dsfLogin) { throw 'A username is required.' }
        $dsfDesktop = [Environment]::GetFolderPath('Desktop')
        if (-not $dsfDesktop -or -not (Test-Path -LiteralPath $dsfDesktop -PathType Container)) { throw 'The Windows Desktop folder could not be found.' }
        $dsfStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $dsfReportPath = Join-Path $dsfDesktop ('DSF-capture-' + $dsfStamp + '.txt')
        $dsfSqlPath = Join-Path ([IO.Path]::GetTempPath()) ('DSF-capture-' + [guid]::NewGuid().ToString('N') + '.sql')
        $dsfSql = @'
${sql}'@
        [IO.File]::WriteAllText($dsfSqlPath, $dsfSql, (New-Object Text.UTF8Encoding($false)))
        Write-Host 'Read-only capture: all-plant source inventory and ${options(input).sources.length} selected source histories.'
        Write-Host 'Each SQL statement is limited to 20 seconds. A slow server can take several minutes.'
        Write-Host 'A password prompt follows; the password is not written to the report.'
        # -X ignores psqlrc, -W prompts securely, ON_ERROR_STOP aborts at the first SQL error.
        $env:PGCONNECT_TIMEOUT = '10'
        $env:PGCLIENTENCODING = 'UTF8'
        & $dsfPsqlPath -X -W -h $dsfServer -p $dsfPortNumber -U $dsfLogin -d maindblocal --set=ON_ERROR_STOP=1 --pset=pager=off --file=$dsfSqlPath --output=$dsfReportPath
        $dsfExitCode = $LASTEXITCODE
        if ($dsfExitCode -ne 0) { throw ('psql exited with code ' + $dsfExitCode + '. The report is incomplete; send the error shown above.') }
        $dsfCompleted = $null
        $dsfHeader = $null
        $dsfSeenDatasets = @{}
        $dsfSeenSources = @{}
        $dsfReviewCount = 0
        foreach ($dsfLine in [IO.File]::ReadLines($dsfReportPath)) {
            if ($dsfLine.StartsWith('{')) {
                try { $dsfRecord = $dsfLine | ConvertFrom-Json } catch { throw 'The report contains invalid JSON and is incomplete.' }
                if ($dsfRecord.kind -eq 'CAPTURE_HEADER') {
                    if ($dsfHeader) { throw 'Duplicate capture header; the report is incomplete.' }
                    $dsfHeader = $dsfRecord
                }
                if ($dsfRecord.kind -eq 'SOURCE_VALIDATION') {
                    $dsfSourceKey = [string]$dsfRecord.source_id
                    if ($dsfSeenSources.ContainsKey($dsfSourceKey)) { throw 'Duplicate source validation; the report is incomplete.' }
                    $dsfSeenSources[$dsfSourceKey] = $true
                }
                if ($dsfRecord.kind -eq 'DATASET') {
                    $dsfDatasetKey = [string]$dsfRecord.dataset + '|' + [string]$dsfRecord.source_id
                    if ($dsfSeenDatasets.ContainsKey($dsfDatasetKey)) { throw 'Duplicate dataset manifest; the report is incomplete.' }
                    $dsfSeenDatasets[$dsfDatasetKey] = $true
                    if ($dsfRecord.manifest.status -ne 'complete') { $dsfReviewCount++ }
                }
                if ($dsfRecord.kind -eq 'CAPTURE_COMPLETED' -and $dsfRecord.marker -eq '${MARKER}' -and $dsfRecord.transaction_finished -eq 'rolled_back') {
                    if ($dsfCompleted) { throw 'Duplicate completion marker; the report is incomplete.' }
                    $dsfCompleted = $dsfRecord
                }
            }
        }
        if (-not $dsfHeader -or -not $dsfCompleted) { throw 'The header or completion marker is missing. Treat this report as incomplete.' }
        if ($dsfSeenDatasets.Count -ne $dsfHeader.expected_dataset_manifests -or $dsfSeenDatasets.Count -ne $dsfCompleted.expected_dataset_manifests -or
            $dsfSeenSources.Count -ne $dsfHeader.expected_source_validations -or $dsfSeenSources.Count -ne $dsfCompleted.expected_source_validations) {
            throw 'Expected source/dataset manifest counts do not match. Treat this report as incomplete.'
        }
        foreach ($dsfPlan in $dsfHeader.planned_datasets) {
            if ($dsfPlan.scope -eq 'global') {
                if (-not $dsfSeenDatasets.ContainsKey([string]$dsfPlan.dataset + '|')) { throw ('Missing dataset manifest: ' + $dsfPlan.dataset) }
            } else {
                foreach ($dsfExpectedSource in $dsfHeader.coverage.detailed_sources) {
                    if (-not $dsfSeenDatasets.ContainsKey([string]$dsfPlan.dataset + '|' + [string]$dsfExpectedSource.sourceId)) { throw ('Missing selected-source manifest: ' + $dsfPlan.dataset) }
                }
            }
        }
        foreach ($dsfExpectedSource in $dsfHeader.coverage.detailed_sources) {
            if (-not $dsfSeenSources.ContainsKey([string]$dsfExpectedSource.sourceId)) { throw 'A selected source validation is missing.' }
        }
        Write-Host ('Capture finished. Report: ' + $dsfReportPath)
        Write-Host ('Manifests requiring coverage review: ' + $dsfReviewCount)
        Write-Host 'Send the report back. Completion confirms the export finished; manifest review and report formulas still determine coverage/parity.'
    } catch {
        if ($dsfReportPath -and (Test-Path -LiteralPath $dsfReportPath)) {
            $dsfPartialPath = $dsfReportPath + '.partial'
            Move-Item -LiteralPath $dsfReportPath -Destination $dsfPartialPath
            Write-Host ('INCOMPLETE report retained at: ' + $dsfPartialPath)
        }
        throw
    } finally {
        if ($dsfSqlPath -and (Test-Path -LiteralPath $dsfSqlPath)) { Remove-Item -LiteralPath $dsfSqlPath }
        $env:PGCONNECT_TIMEOUT = $dsfPreviousConnectTimeout
        $env:PGCLIENTENCODING = $dsfPreviousEncoding
    }
}
`;
}

export function writeGeneratedArtifacts(directory = fileURLToPath(new URL('.', import.meta.url)), input = {}) {
  writeFileSync(resolve(directory, 'DSF-capture.sql'), buildCaptureSql(input));
  writeFileSync(resolve(directory, 'DSF-capture.ps1'), buildPowerShell(input));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeGeneratedArtifacts();
