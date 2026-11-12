/* DSFCOUNT1. Fixed SELECT statements; all data values are bound parameters. */
const DANA_MACHINES_SELECT = `SELECT m.id::text AS machine_id, btrim(m.machine_number) AS machine_number,
 d.code AS department, m.machine_type, (m.active AND m.enabled AND d.active AND d.enabled) AS active
 FROM public.machines m JOIN public.departments d ON d.id=m.department_id
 WHERE m."deletedAt" IS NULL AND d."deletedAt" IS NULL`;
/**
 * Lapper machines (any machine with a lapper.machines profile) never take DSF counts. The Lapper
 * schema is created at application bootstrap, after this reader first loads machines, so look for
 * it first; until it exists there are no Lapper machines to leave out.
 */
export const LAPPER_MACHINES_TABLE_SQL = `SELECT to_regclass('lapper.machines') IS NOT NULL AS present`;
export const DANA_MACHINES_SQL = `${DANA_MACHINES_SELECT}
 AND NOT EXISTS (SELECT 1 FROM lapper.machines l WHERE l.public_machine_id=m.id) ORDER BY m.machine_number,m.id`;
export const DANA_MACHINES_NO_LAPPER_SCHEMA_SQL = `${DANA_MACHINES_SELECT} ORDER BY m.machine_number,m.id`;
export const SOURCE_IDENTITY_SQL = `SELECT
 to_regclass('public.tbl_whiteboard_cycles_master') IS NOT NULL AS is_source,
 to_regclass('public.cutter_machine_runs') IS NULL AS not_meshforge,
 to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now_utc,
 current_setting('transaction_read_only')='on' AS read_only`;
export const ROLE_CHECK_SQL = `WITH RECURSIVE wanted(oid) AS (
 SELECT unnest(ARRAY['public.tbl_whiteboard_cycles_master'::regclass,'public.tbl_whiteboard_machines'::regclass,
 'public.tbl_op'::regclass,'public.tbl_line'::regclass,'public.tbl_shift'::regclass,
 'public.tbl_op_state_reason'::regclass,'public.tbl_whiteboard'::regclass,'public.tbl_department'::regclass]::oid[])
), relations(oid) AS (SELECT oid FROM wanted UNION SELECT i.inhrelid FROM pg_inherits i JOIN relations r ON i.inhparent=r.oid)
SELECT NOT EXISTS(SELECT 1 FROM pg_roles r WHERE
 (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
 AND (r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER'))) AS role_safe,
 NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_database_create,
 NOT has_schema_privilege(current_user,'public','CREATE') AS no_schema_create,
 NOT EXISTS(SELECT 1 FROM relations r WHERE
 has_table_privilege(current_user,r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
 OR has_any_column_privilege(current_user,r.oid,'INSERT,UPDATE')) AS no_source_writes,
 (SELECT bool_and(has_table_privilege(current_user,oid,'SELECT')) FROM wanted) AS can_read`;
export const MAPPING_SQL = `SELECT wm.id::text AS mapping_id,wm.whiteboard_id::text,wm.op_id::text,wm.line_id::text,
 wm.active AS mapping_active,w.active AS whiteboard_active,btrim(w.name) AS whiteboard_name,
 l.name AS line_name,l.department_id::text,d.name AS department_name,o.name AS op_name,
 (o.line_id=wm.line_id) AS operation_line_matches,
 (SELECT count(*)::int FROM public.tbl_whiteboard_machines x WHERE x.op_id=wm.op_id AND x.active) AS active_mappings,
 (SELECT array_agg(x.id::text ORDER BY x.id::text) FROM public.tbl_whiteboard_machines x WHERE x.op_id=wm.op_id) AS known_mapping_ids,
 (SELECT count(*)::int FROM public.tbl_op_state_reason r WHERE r.op_id=wm.op_id AND r.code::text='1') AS running_reasons
 FROM public.tbl_whiteboard_machines wm JOIN public.tbl_whiteboard w ON w.id=wm.whiteboard_id
 JOIN public.tbl_op o ON o.id=wm.op_id JOIN public.tbl_line l ON l.id=wm.line_id
 LEFT JOIN public.tbl_department d ON d.id=l.department_id WHERE wm.id=$1::uuid`;
export const SHIFTS_SQL = `SELECT s.id::text,s.shift AS number,
 to_char(s.start_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS starts_at,
 to_char(s.end_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ends_at,
 (s.start_time AT TIME ZONE 'America/Indiana/Indianapolis')::date::text AS local_date
 FROM public.tbl_shift s WHERE s.line_id=$1::uuid
 AND s.start_time >= $2::timestamptz - interval '32 hours'
 AND s.start_time <= $2::timestamptz + interval '32 hours'
 ORDER BY s.start_time,s.id LIMIT 13`;
// Keep c.timestamp comparisons bare for partition pruning/index lookup. Parent PK=(id,timestamp).
export const CYCLES_SQL = `WITH bounded AS MATERIALIZED (
 SELECT c.id,c."timestamp",c.part_count,c.code FROM public.tbl_whiteboard_cycles_master c
 WHERE c.whiteboard_id=$1::uuid AND c.machine_id=$2::uuid
 AND c."timestamp">=$3::timestamptz AND c."timestamp"<$4::timestamptz
 ORDER BY c."timestamp",c.id LIMIT 10001
) SELECT c.id::text,(extract(epoch from c."timestamp")*1000000)::bigint::text AS at_us,
 to_char(c."timestamp" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
 c.part_count AS parts,r.code::text AS reason_code,r.op_id::text AS reason_op
 FROM bounded c LEFT JOIN public.tbl_op_state_reason r ON r.id=c.code
 ORDER BY c."timestamp",c.id`;

// Refuse an incomplete physical-machine shift total when an inactive alternative carried production.
export const OTHER_MAPPING_ACTIVITY_SQL = `SELECT EXISTS (
 SELECT 1 FROM public.tbl_whiteboard_cycles_master c
 LEFT JOIN public.tbl_op_state_reason r ON r.id=c.code
 WHERE c.whiteboard_id=$1::uuid AND c.machine_id=$2::uuid
 AND c."timestamp">=$3::timestamptz AND c."timestamp"<$4::timestamptz
 AND (c.part_count<0 OR (c.part_count>0 AND (r.id IS NULL OR r.op_id IS DISTINCT FROM $5::uuid OR r.code::text='1')))
 LIMIT 1) AS has_activity`;
