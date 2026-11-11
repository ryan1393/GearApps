// Clears operational data from the MeshForge PostgreSQL database in .env and keeps
// users and base data. Runs as a preview unless --apply is given.
//
// Emptied: blades, trays, containers and the blade sets packed in them, every location,
// cutter builds and their events, checks, teardowns and machine runs, coater shipments,
// Greenshed/DSF counts and the Cancel Last journal. The COATER-STAGING location is
// recreated by the API the next time it starts.
// Kept: users, departments, models, parts, part summaries, blade requirements, cutter
// body definitions, cutter bodies, roll masters, gearsets, machines, lookup lists,
// server settings, label printers, Coater RPA setup, DSF machine mappings and all Lapper data.
//
// Only the tables named in EMPTY are truncated, without CASCADE: if a kept table still
// referenced one of them, PostgreSQL refuses and nothing is deleted.
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
  'locations', 'cutter_body_shelf_placements',
  // Cutter builds and everything that happened to them
  'cutter_builds', 'cutter_build_blades', 'cutter_build_trays', 'cutter_build_locations',
  'cutter_events', 'cutter_cmm_checks', 'cutter_frequency_checks',
  'cutter_teardowns', 'cutter_machine_runs', 'cutter_legacy_orphan_records',
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
  'models', 'parts', 'part_summaries', 'part_types', 'cutter_blade_requirements',
  'cutter_body_definitions', 'cutter_bodies', 'roll_masters', 'gearsets', 'machines',
  'cutter_build_statuses', 'cutter_event_types', 'cutter_pull_reasons',
  'cutter_check_results', 'tray_stages',
  'gear_environment_settings', 'gear_label_printers',
  'dana_rpa_settings_v1', 'dana_rpa_template_v1', 'dana_rpa_part_map_v1',
  'dana_dsf_machine_mapping_v1', 'dana_dsf_machine_mapping_audit_v1',
  'dana_greenshed_shift_tracking',
];

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

function printCounts(title, counts) {
  console.log(title);
  const width = Math.max(...[...counts.keys()].map((name) => name.length), 10);
  for (const [table, count] of counts) console.log(`  ${table.padEnd(width)}  ${count}`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmed = process.argv.includes(CONFIRM_FLAG);
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
    const other = [...present].filter((table) => !EMPTY.includes(table) && !KEEP.includes(table)).sort();
    for (const required of ['users', 'locations', 'trays']) {
      if (!present.has(required)) throw new Error(`Table ${required} is missing: this is not a MeshForge database.`);
    }

    console.log(`[TARGET] ${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`);
    const before = await countRows(client, empty);
    const keptBefore = await countRows(client, keep);
    printCounts('\nWill be EMPTIED (rows now):', before);
    printCounts('\nWill be KEPT (rows now):', keptBefore);
    if (other.length) console.log(`\nNot touched (not on either list): ${other.join(', ')}`);
    console.log('Not touched: every table in the lapper schema.');

    if (!apply) {
      console.log('\n[SAFE] Preview only. Nothing was deleted.');
      console.log('To clear the data, stop the MeshForge API and run:');
      console.log('  npm run clear:operational-data:apply');
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
      kept: Object.fromEntries(keptBefore),
      note: 'Counts only. The cleared rows were not backed up by this command.',
    }, null, 2) + '\n');
    console.log(`\n[AUDIT] ${manifestPath}`);

    await client.query('BEGIN');
    try {
      // A running API holds locks on these tables: fail fast rather than wait behind it.
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query(`TRUNCATE TABLE ${empty.map((table) => `public.${quoteIdent(table)}`).join(', ')} RESTART IDENTITY`);
      const left = [...(await countRows(client, empty))].filter(([, count]) => count !== 0);
      if (left.length) throw new Error(`Rows remain in ${left.map(([table]) => table).join(', ')}.`);
      const changed = [...(await countRows(client, keep))].filter(([table, count]) => count !== keptBefore.get(table));
      if (changed.length) throw new Error(`Kept tables changed: ${changed.map(([table]) => table).join(', ')}.`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '55P03') throw new Error('Another connection is using these tables. Stop the MeshForge API and try again. Nothing was deleted.');
      if (error?.code === '0A000') throw new Error(`A kept table still points at a table being emptied, so nothing was deleted: ${error.message}. ${error.detail ?? ''}`.trim());
      throw error;
    }

    console.log(`[PASS] Emptied ${empty.length} tables. Users and base data kept: ${keep.length} tables unchanged.`);
    console.log('Next: start MeshForge and create shelves in Admin > Locations > Bulk shelf locations.');
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
