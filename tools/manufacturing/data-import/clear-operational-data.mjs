// Clears operational data from the MeshForge PostgreSQL database in .env and keeps
// users and base data. Runs as a preview unless --apply is given.
//
// Emptied: blades, trays, containers and the blade sets packed in them, cutter builds and
// their events, checks, teardowns and machine runs, coater shipments, Greenshed/DSF counts
// and the Cancel Last journal; and any other table that points at those, directly or through
// another table (tables left by older releases, e.g. dana_coater_set_blades_v147). Such a table
// on the KEEP list or outside the public schema stops the run before anything is deleted.
// Locations (--locations=):
//   keep-shelves (default)  shelf/layer/bin locations (CGDR-A1A and the other Cuttergrind
//                           shelf bins) and COATER-STAGING are kept, empty; the rest are deleted.
//   delete-all              every location is deleted (the API recreates COATER-STAGING when
//                           it next starts).
// Kept: users, departments, models, parts, part summaries (with their RING/PINION HOS and
// blade settings), blade requirements, cutter
// body definitions, cutter bodies, roll masters, gearsets, machines, lookup lists,
// server settings, label printers, Coater RPA setup, DSF machine mappings and all Lapper data.
//
// Tables are truncated without CASCADE in one transaction, and locations are then deleted row
// by row: if anything not being emptied still points at them, PostgreSQL refuses and nothing is
// deleted. The preview lists those blockers first.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Operational tables that are emptied. Tables missing from this database are skipped. */
export const EMPTY = [
  // Blades, trays, containers and where they are
  'blades', 'blade_history', 'blade_tray',
  'trays', 'tray_grinding_runs', 'location_tray',
  'containers', 'container_tray',
  // Ground blade sets packed into coater containers (they point at containers, blades,
  // trays and locations, so they must be emptied with them)
  'container_sets', 'container_set_blades',
  'cutter_body_shelf_placements',
  // Cutter builds and everything that happened to them
  'cutter_builds', 'cutter_build_blades', 'cutter_build_trays', 'cutter_build_locations',
  'cutter_events', 'cutter_cmm_checks', 'cutter_frequency_checks',
  'cutter_teardowns', 'cutter_machine_runs',
  // Request fulfillment evidence points at those builds; clear it only in this explicit backup-first floor reset.
  'cutter_requests', 'cutter_request_history', 'cutter_request_build_allocations',
  // Coater shipments and RPA requests (the RPA settings, template and part map stay)
  'dana_coater_shipments_v1', 'dana_coater_shipment_containers_v1',
  'dana_coater_shipment_events_v1', 'dana_rpa_requests_v1',
  // Greenshed production counts and DSF run state (the DSF machine mapping stays)
  'dana_greenshed_shift_counts', 'dana_greenshed_count_high_water',
  'dana_dsf_cutter_machine_state_v1', 'dana_dsf_cutter_run_shifts_v1',
  // Cancel Last journal: it points at the rows removed above
  'dana_workflow_journal_v1', 'dana_workflow_changes_v1',
];

/** Tables that must keep every row. Checked before and after, inside the transaction. */
export const KEEP = [
  'users', 'departments',
  'meshforge_roles', 'meshforge_user_roles', 'meshforge_badges', 'meshforge_access_audit',
  'models', 'parts', 'part_summaries', 'part_types', 'cutter_blade_requirements', 'cutter_summary_body_rules',
  'part_summary_part_type_blades',
  'cutter_body_definitions', 'cutter_bodies', 'roll_masters', 'gearsets', 'machines',
  'cutter_build_statuses', 'cutter_event_types', 'cutter_pull_reasons',
  'cutter_check_results', 'tray_stages',
  'gear_environment_settings', 'gear_label_printers',
  'dana_rpa_settings_v1', 'dana_rpa_template_v1', 'dana_rpa_part_map_v1',
  'dana_dsf_machine_mapping_v1', 'dana_dsf_machine_mapping_audit_v1',
  'dana_greenshed_shift_tracking',
];

/** Cleared row by row, as --locations= chooses; never truncated. */
export const LOCATIONS_TABLE = 'locations';

/** --locations= choices. keep-shelves is the default. */
export const LOCATION_MODES = {
  'keep-shelves': 'keep the shelf/layer/bin locations and COATER-STAGING (empty), delete the rest',
  'delete-all': 'delete every location',
};
export const DEFAULT_LOCATION_MODE = 'keep-shelves';

/** The --locations= value from the command line; throws on an unknown one. */
export function parseLocationMode(argv) {
  const arg = argv.find((value) => value.startsWith('--locations='));
  const mode = arg ? arg.slice('--locations='.length) : DEFAULT_LOCATION_MODE;
  if (!Object.hasOwn(LOCATION_MODES, mode)) {
    throw new Error(`Unknown --locations=${mode}. Use ${Object.keys(LOCATION_MODES).map((m) => `--locations=${m}`).join(' or ')}.`);
  }
  return mode;
}

/**
 * Shelf/layer/bin tags made by Admin > Locations > Bulk shelf locations: prefix, shelf letter,
 * layer 1-9 and bin letter (CGDR-A1A). Must match CUTTERGRIND_BIN_SHELF_PATTERN and
 * CUTTERGRIND_ROUGH_SHELF_PATTERN in libs/manufacturing/shared/util-constants (the contract
 * test checks this). Also valid as a PostgreSQL regular expression.
 */
export const KEPT_SHELF_LOCATION_PATTERN = '^(CGDR|CGDP|CGFR|CGFP|CGRR|CGRP)-[A-Z][1-9][A-Z]$';
/** The coater staging location the API seeds; kept so it does not have to be recreated. */
export const KEPT_LOCATION_SERIALS = ['COATER-STAGING'];

const KEPT_LOCATION_WHERE = 'upper(serial_number) ~ $1 OR upper(serial_number) = ANY($2::text[])';
const keptLocationParams = [KEPT_SHELF_LOCATION_PATTERN, KEPT_LOCATION_SERIALS];

/** Which locations survive in each mode: SQL over public.locations, with bound parameters. */
function keptLocations(mode) {
  return mode === 'delete-all'
    ? { where: 'false', params: [] }
    : { where: KEPT_LOCATION_WHERE, params: keptLocationParams };
}

/**
 * Every table that points at one of `names` (public schema), directly or through another
 * table, read from the database's own foreign keys. The named tables are not included.
 */
const DEPENDENTS_SQL = `
  WITH RECURSIVE deps(rel) AS (
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
    UNION
    SELECT con.conrelid FROM pg_constraint con JOIN deps d ON con.confrelid = d.rel
     WHERE con.contype = 'f'
  )
  SELECT n.nspname AS schema, c.relname AS table
    FROM deps JOIN pg_class c ON c.oid = deps.rel JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT (n.nspname = 'public' AND c.relname = ANY($1::text[]))
   ORDER BY 1, 2`;

/** Foreign keys from other tables to public.locations (single-column, as MeshForge's are). */
const LOCATION_REFERENCES_SQL = `
  SELECT n.nspname AS schema, c.relname AS table, a.attname AS column, fa.attname AS ref
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
   WHERE con.contype = 'f' AND con.confrelid = 'public.locations'::regclass
     AND con.conrelid <> 'public.locations'::regclass
   ORDER BY 1, 2, 3`;

export const CONFIRM_FLAG = '--yes-delete-operational-data';

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`;

async function countRows(client, tables) {
  const counts = new Map();
  for (const table of tables) {
    const { rows } = await client.query(`SELECT COUNT(*)::bigint AS count FROM public.${quoteIdent(table)}`);
    counts.set(table, Number(rows[0]?.count ?? 0));
  }
  return counts;
}

async function countLocations(client, mode) {
  const { where, params } = keptLocations(mode);
  const { rows } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE ${where})::bigint AS kept,
            COUNT(*) FILTER (WHERE NOT (${where}))::bigint AS deleted
       FROM public.locations`,
    params,
  );
  return { kept: Number(rows[0]?.kept ?? 0), deleted: Number(rows[0]?.deleted ?? 0) };
}

/** Rows outside the emptied tables that point at a location about to be deleted. */
async function locationBlockers(client, mode, emptied) {
  const { where, params } = keptLocations(mode);
  const { rows: references } = await client.query(LOCATION_REFERENCES_SQL);
  const blockers = [];
  for (const ref of references) {
    if (ref.schema === 'public' && emptied.includes(ref.table)) continue;
    const { rows } = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(ref.schema)}.${quoteIdent(ref.table)} x
        WHERE x.${quoteIdent(ref.column)} IN (SELECT l.${quoteIdent(ref.ref)} FROM public.locations l WHERE NOT (${where}))`,
      params,
    );
    const count = Number(rows[0]?.count ?? 0);
    if (count) blockers.push({ name: `${ref.schema}.${ref.table}.${ref.column}`, count });
  }
  return blockers;
}

function printCounts(title, counts) {
  console.log(title);
  const width = Math.max(...[...counts.keys()].map((name) => name.length), 10);
  for (const [table, count] of counts) console.log(`  ${table.padEnd(width)}  ${count}`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmed = process.argv.includes(CONFIRM_FLAG);
  const locationMode = parseLocationMode(process.argv.slice(2));
  const env = { ...loadDotEnv(path.resolve(root, '.env')), ...process.env };
  for (const key of ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USERNAME', 'DATABASE_PASSWORD', 'DATABASE_NAME']) {
    if (!env[key]) throw new Error(`Missing ${key} in project .env/environment.`);
  }

  const client = new Client({
    host: env.DATABASE_HOST,
    port: Number(env.DATABASE_PORT),
    user: env.DATABASE_USERNAME,
    password: String(env.DATABASE_PASSWORD),
    database: env.DATABASE_NAME,
  });

  await client.connect();
  try {
    const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
    const present = new Set(rows.map((row) => row.tablename));
    const empty = EMPTY.filter((table) => present.has(table));
    const keep = KEEP.filter((table) => present.has(table));
    for (const required of ['users', 'locations', 'trays']) {
      if (!present.has(required)) throw new Error(`Table ${required} is missing: this is not a MeshForge database.`);
    }

    // Tables not on the lists (e.g. left by older releases) that point at the emptied ones
    // cannot keep their rows: they are emptied too, unless they must be kept.
    const { rows: dependents } = await client.query(DEPENDENTS_SQL, [empty]);
    const refused = dependents.filter((dep) => dep.schema !== 'public' || KEEP.includes(dep.table) || dep.table === LOCATIONS_TABLE);
    const alsoEmpty = dependents.filter((dep) => !refused.includes(dep)).map((dep) => dep.table);
    const targets = [...empty, ...alsoEmpty];
    const other = [...present]
      .filter((table) => !targets.includes(table) && !KEEP.includes(table) && table !== LOCATIONS_TABLE).sort();

    console.log(`[TARGET] ${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`);
    const before = await countRows(client, empty);
    const alsoBefore = await countRows(client, alsoEmpty);
    const keptBefore = await countRows(client, keep);
    const locationsBefore = await countLocations(client, locationMode);
    const blockers = await locationBlockers(client, locationMode, targets);
    printCounts('\nWill be EMPTIED (rows now):', before);
    if (alsoEmpty.length) printCounts('\nAlso EMPTIED: not on the lists, but they point at the tables above (rows now):', alsoBefore);
    console.log(`\nLocations (--locations=${locationMode}: ${LOCATION_MODES[locationMode]}):`);
    console.log(`  deleted: ${locationsBefore.deleted}`);
    if (locationMode === 'delete-all') console.log('  kept: 0 (the API recreates COATER-STAGING when it next starts)');
    else console.log(`  kept, emptied (shelf/layer/bin bins and COATER-STAGING): ${locationsBefore.kept}`);
    printCounts('\nWill be KEPT (rows now):', keptBefore);
    if (other.length) console.log(`\nNot touched (not on either list): ${other.join(', ')}`);
    console.log('Not touched: every table in the lapper schema.');

    const problems = [];
    if (refused.length) {
      problems.push(`These kept tables point at operational data, so it cannot be emptied: ${refused.map((dep) => `${dep.schema}.${dep.table}`).join(', ')}.`);
    }
    if (blockers.length) {
      problems.push(`These rows point at locations that would be deleted: ${blockers.map((b) => `${b.name} (${b.count})`).join(', ')}.` +
        (locationMode === 'delete-all' ? ' Use --locations=keep-shelves, or clear those rows first.' : ' Clear those rows first.'));
    }
    if (problems.length) {
      for (const problem of problems) console.error(`\n[STOP] ${problem}`);
      throw new Error('The clear cannot run on this database as it is. Nothing was deleted.');
    }

    if (!apply) {
      console.log('\n[SAFE] Preview only. Nothing was deleted.');
      // The launchers ask for confirmation next and run the apply step themselves.
      if (!env.MESHFORGE_CLEAR_FROM_LAUNCHER) {
        console.log('To clear the data, stop the MeshForge API and run:');
        console.log(`  npm run clear:operational-data:apply${locationMode === DEFAULT_LOCATION_MODE ? '' : ` -- --locations=${locationMode}`}`);
      }
      return;
    }
    if (!confirmed) {
      console.log(`\nDESTRUCTIVE ACTION BLOCKED. Re-run with --apply ${CONFIRM_FLAG}.`);
      process.exitCode = 2;
      return;
    }

    const manifestDir = path.join(root, 'tools', 'manufacturing', 'data-import', 'work');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, 'pre-clear-operational-data-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      database_host: env.DATABASE_HOST,
      database_name: env.DATABASE_NAME,
      emptied: Object.fromEntries(before),
      also_emptied: Object.fromEntries(alsoBefore),
      location_mode: locationMode,
      locations: locationsBefore,
      kept: Object.fromEntries(keptBefore),
      note: 'Counts only. The cleared rows were not backed up by this command.',
    }, null, 2) + '\n');
    console.log(`\n[AUDIT] ${manifestPath}`);

    await client.query('BEGIN');
    try {
      // A running API holds locks on these tables: fail fast rather than wait behind it.
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query(`TRUNCATE TABLE ${targets.map((table) => `public.${quoteIdent(table)}`).join(', ')} RESTART IDENTITY`);
      const left = [...(await countRows(client, targets))].filter(([, count]) => count !== 0);
      if (left.length) throw new Error(`Rows remain in ${left.map(([table]) => table).join(', ')}.`);
      const kept = keptLocations(locationMode);
      await client.query(`DELETE FROM public.locations WHERE NOT (${kept.where})`, kept.params);
      const locationsAfter = await countLocations(client, locationMode);
      if (locationsAfter.deleted !== 0 || locationsAfter.kept !== locationsBefore.kept) {
        throw new Error(`Locations did not clear as expected: ${JSON.stringify(locationsAfter)}.`);
      }
      const changed = [...(await countRows(client, keep))].filter(([table, count]) => count !== keptBefore.get(table));
      if (changed.length) throw new Error(`Kept tables changed: ${changed.map(([table]) => table).join(', ')}.`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '55P03') throw new Error('Another connection is using these tables. Stop the MeshForge API and try again. Nothing was deleted.');
      if (error?.code === '0A000') throw new Error(`A kept table still points at a table being emptied, so nothing was deleted: ${error.message}. ${error.detail ?? ''}`.trim());
      if (error?.code === '23503') throw new Error(`A kept table still points at a location being deleted, so nothing was deleted: ${error.message}. ${error.detail ?? ''}`.trim());
      throw error;
    }

    console.log(`[PASS] Emptied ${targets.length} tables${alsoEmpty.length ? ` (also ${alsoEmpty.join(', ')})` : ''}.`);
    console.log(locationMode === 'delete-all'
      ? `Deleted all ${locationsBefore.deleted} locations.`
      : `Deleted ${locationsBefore.deleted} locations; kept ${locationsBefore.kept} shelf/layer/bin and staging locations.`);
    console.log(`Users and base data kept: ${keep.length} tables unchanged.`);
    console.log(locationMode === 'delete-all'
      ? 'Next: start MeshForge, make shelves in Admin > Locations > Bulk shelf locations, then trays and containers in Admin > Launch Setup.'
      : 'Next: start MeshForge, then make trays and containers in Admin > Launch Setup.');
  } finally {
    await client.end();
  }
}

// Run only when executed directly, so the contract test can import the lists.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  });
}
