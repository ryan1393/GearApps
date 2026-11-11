import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const tables = [
  'dana_coater_shipments_v1', 'dana_coater_shipment_events_v1',
  'dana_rpa_settings_v1', 'dana_rpa_part_map_v1', 'dana_rpa_requests_v1',
];

function run(command, args, input, container) {
  const executable = container ? 'docker' : command;
  const parameters = container ? ['exec', '-i', container, command, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, parameters, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 32 * 1024 * 1024) {
        reject(new Error(`${command} returned more data than expected.`));
        child.kill();
      }
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => reject(new Error(`${command} could not start. ${error.message}`)));
    child.stdin.on('error', error => {
      // pg_restore can finish selecting tables before the archive input is exhausted.
      if (!['EPIPE', 'EOF'].includes(error.code)) reject(new Error(`${command} could not read its input. ${error.message}`));
    });
    child.on('close', status => {
      if (status !== 0) reject(new Error(`${command} failed. ${stderr.trim()}`));
      else resolve(stdout.replace(/\r\n/g, '\n'));
    });
    child.stdin.end(input);
  });
}

async function copyTables(dump, container) {
  const args = ['--data-only', '--no-owner', '--no-privileges', '--file=-', ...tables.flatMap(table => ['-t', table])];
  const contents = await (container ? run('pg_restore', args, readFileSync(dump), container) : run('pg_restore', [...args, dump]));
  const copies = new Map();
  for (const match of contents.matchAll(/^COPY public\.(\w+) \(([\w", ]+)\) FROM stdin;\n([\s\S]*?)^\\\.$/gm)) {
    const [, table, columns, rows] = match;
    if (tables.includes(table)) copies.set(table, `COPY import_${table} (${columns}) FROM stdin;\n${rows}\\.`);
  }
  if (copies.size !== tables.length) throw new Error('The dump is missing one or more Coater RPA tables.');
  return tables.map(table => `CREATE TEMP TABLE import_${table} (LIKE public.${table});\n${copies.get(table)}`).join('\n');
}

function importSql(copies, apply) {
  return `BEGIN;
SET LOCAL lock_timeout = '8s';
SELECT pg_advisory_xact_lock(hashtext('dana-coater-shipments-v1'));
LOCK TABLE ${tables.map(table => 'public.' + table).join(', ')} IN SHARE ROW EXCLUSIVE MODE;
${copies}

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM import_dana_rpa_settings_v1 WHERE id=1)
     OR NOT EXISTS (SELECT 1 FROM import_dana_rpa_requests_v1) THEN
    RAISE EXCEPTION 'The dump has no RPA settings or saved workbooks.';
  END IF;
  IF EXISTS (SELECT 1 FROM import_dana_rpa_requests_v1 r
      LEFT JOIN import_dana_coater_shipments_v1 s ON s.id=r.shipment_id
      WHERE s.id IS NULL OR s.status <> 'DISPATCHED' OR r.revision > s.revision) THEN
    RAISE EXCEPTION 'The saved requests must reference dispatched shipment revisions in the dump.';
  END IF;
  IF EXISTS (SELECT 1 FROM import_dana_coater_shipments_v1 old
      JOIN public.dana_coater_shipments_v1 live ON live.id=old.id OR live.number=old.number
      JOIN import_dana_rpa_requests_v1 r ON r.shipment_id=old.id
      WHERE live.id<>old.id OR live.number<>old.number OR live.status<>'DISPATCHED' OR live.revision<r.revision) THEN
    RAISE EXCEPTION 'An archived shipment conflicts with the target. Review the shipment history before importing.';
  END IF;
  IF EXISTS (SELECT 1 FROM import_dana_rpa_requests_v1 old
      JOIN public.dana_rpa_requests_v1 live ON live.id=old.id OR live.number=old.number
        OR (live.shipment_id=old.shipment_id AND live.revision=old.revision)
      WHERE (live.id,live.number,live.shipment_id,live.revision,live.po,live.document,live.details)
        IS DISTINCT FROM (old.id,old.number,old.shipment_id,old.revision,old.po,old.document,old.details)) THEN
    RAISE EXCEPTION 'An archived RPA request conflicts with the target. Review the request history before importing.';
  END IF;
END $$;

CREATE TEMP TABLE rpa_import_report (item text, inserted bigint);
WITH added AS (
  INSERT INTO public.dana_coater_shipments_v1
    (id,number,status,revision,destination,notes,manifest,content_hash,reviewed_revision,printed_revision,
     created_at,created_by,updated_at,dispatched_at,dispatched_by,po,po_source,coater_legal_name)
  SELECT id,number,status,revision,destination,notes,manifest,content_hash,reviewed_revision,printed_revision,
     created_at,created_by,updated_at,dispatched_at,dispatched_by,po,po_source,coater_legal_name
  FROM import_dana_coater_shipments_v1 s
  WHERE EXISTS (SELECT 1 FROM import_dana_rpa_requests_v1 r WHERE r.shipment_id=s.id)
  ON CONFLICT (id) DO NOTHING RETURNING id
) INSERT INTO rpa_import_report SELECT 'Archived shipments',count(*) FROM added;
WITH added AS (
  INSERT INTO public.dana_coater_shipment_events_v1 (id,shipment_id,revision,kind,at,actor,actor_id,detail,document)
  SELECT id,shipment_id,revision,kind,at,actor,actor_id,detail,document
  FROM import_dana_coater_shipment_events_v1 e
  WHERE EXISTS (SELECT 1 FROM import_dana_rpa_requests_v1 r WHERE r.shipment_id=e.shipment_id)
  ON CONFLICT (id) DO NOTHING RETURNING id
) INSERT INTO rpa_import_report SELECT 'Archived shipment events',count(*) FROM added;
WITH added AS (
  INSERT INTO public.dana_rpa_settings_v1 (id,next_number,recipients_to,recipients_cc,unit_price,insurance_unit,
    updated_at,updated_by,coater_display_name,default_po,default_po_expires_on,default_po_enabled)
  SELECT id,next_number,recipients_to,recipients_cc,unit_price,insurance_unit,updated_at,updated_by,
    coater_display_name,default_po,default_po_expires_on,default_po_enabled
  FROM import_dana_rpa_settings_v1 ON CONFLICT (id) DO NOTHING RETURNING id
) INSERT INTO rpa_import_report SELECT 'RPA settings',count(*) FROM added;
WITH added AS (
  INSERT INTO public.dana_rpa_part_map_v1 (summary,part_type,outer_part,inner_part)
  SELECT summary,part_type,outer_part,inner_part FROM import_dana_rpa_part_map_v1
  ON CONFLICT (summary,part_type) DO NOTHING RETURNING summary
) INSERT INTO rpa_import_report SELECT 'RPA part mappings',count(*) FROM added;
WITH added AS (
  INSERT INTO public.dana_rpa_requests_v1 (id,shipment_id,revision,number,po,document,details,recipients_to,
    recipients_cc,email_status,email_error,email_sent_at,created_at,created_by,email_started_at,email_attempts)
  SELECT id,shipment_id,revision,number,po,document,details,recipients_to,recipients_cc,
    CASE WHEN email_status='SENDING' THEN 'UNKNOWN' ELSE email_status END, email_error,email_sent_at,created_at,
    created_by,email_started_at,email_attempts
  FROM import_dana_rpa_requests_v1 ON CONFLICT (id) DO NOTHING RETURNING id
) INSERT INTO rpa_import_report SELECT 'RPA requests and workbooks',count(*) FROM added;

WITH required AS (
  SELECT GREATEST((SELECT next_number FROM import_dana_rpa_settings_v1 WHERE id=1),MAX(number)+1) AS next_number
  FROM public.dana_rpa_requests_v1
) UPDATE public.dana_rpa_settings_v1 settings SET next_number=required.next_number
  FROM required WHERE settings.id=1 AND settings.next_number<required.next_number;
DO $$ DECLARE next_shipment bigint; next_sequence bigint; BEGIN
  SELECT max(substring(number FROM 4)::bigint)+1 INTO next_shipment
    FROM (SELECT number FROM public.dana_coater_shipments_v1
          UNION ALL SELECT number FROM import_dana_coater_shipments_v1) shipments
    WHERE number ~ '^CS-[0-9]+$';
  SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END INTO next_sequence
    FROM public.dana_coater_shipment_number_v1;
  IF next_shipment > next_sequence THEN
    EXECUTE format('ALTER SEQUENCE public.dana_coater_shipment_number_v1 RESTART WITH %s', next_shipment);
  END IF;
END $$;
SELECT current_database() AS target_database;
SELECT * FROM rpa_import_report ORDER BY item;
${apply ? 'COMMIT' : 'ROLLBACK'};
`;
}

try {
  const { values } = parseArgs({ options: {
    dump: { type: 'string' }, database: { type: 'string' }, user: { type: 'string' },
    container: { type: 'string' }, apply: { type: 'boolean' },
  } });
  if (!values.dump || !values.database || !values.user) {
    throw new Error('Usage: node import-coater-rpa.mjs --dump FILE --database DB --user ROLE [--container POSTGRES] [--apply]');
  }
  const copies = await copyTables(values.dump, values.container);
  console.log(await run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '--no-password',
    `--dbname=${values.database}`, `--username=${values.user}`], importSql(copies, values.apply), values.container));
  console.log(values.apply ? 'RPA import committed.' : 'RPA dry run rolled back. Add --apply to commit.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
