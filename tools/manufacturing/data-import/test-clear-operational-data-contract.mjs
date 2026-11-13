// The clear-operational-data command keeps users, base data and shelf/layer/bin locations
// and empties the rest.
import fs from 'node:fs';
import { contractPath } from '../lib/contract-paths.mjs';
import {
  CONFIRM_FLAG, DEFAULT_LOCATION_MODE, EMPTY, KEEP, KEPT_LOCATION_SERIALS, KEPT_SHELF_LOCATION_PATTERN,
  LOCATION_MODES, LOCATIONS_TABLE, parseLocationMode,
} from './clear-operational-data.mjs';

const read = (relative) => fs.readFileSync(contractPath(process.cwd(), relative), 'utf8');
const script = read('tools/manufacturing/data-import/clear-operational-data.mjs');
const cmd = read('commands/CLEAR-OPERATIONAL-DATA.cmd');
const sh = read('commands/CLEAR-OPERATIONAL-DATA.sh');
const pkg = JSON.parse(read('package.json'));
const project = JSON.parse(read('tools/manufacturing/project.json'));
const fail = (message) => { throw new Error(message); };

for (const table of [
  'users', 'departments', 'models', 'parts', 'part_summaries', 'part_types',
  'cutter_blade_requirements', 'cutter_body_definitions', 'cutter_bodies', 'machines',
]) {
  if (!KEEP.includes(table)) fail(`${table} must be kept`);
  if (EMPTY.includes(table)) fail(`${table} must never be emptied`);
}
for (const table of ['trays', 'containers', 'blades', 'cutter_builds', 'dana_workflow_journal_v1']) {
  if (!EMPTY.includes(table)) fail(`${table} must be emptied`);
}
const overlap = EMPTY.filter((table) => KEEP.includes(table));
if (overlap.length) fail(`Tables on both lists: ${overlap.join(', ')}`);
for (const table of ['dana_dsf_history_source_v1', 'dana_dsf_history_hour_v1', 'dana_dsf_history_slice_v1',
  'dana_dsf_history_state_v1', 'dana_dsf_history_issue_v1', 'dana_dsf_history_revision_v1']) {
  if (!KEEP.includes(table) || EMPTY.includes(table)) fail(`${table} must survive operational workflow cleanup`);
}
for (const table of ['container_sets', 'container_set_blades']) {
  if (!EMPTY.includes(table)) fail(`${table} must be emptied with containers and blades`);
}

// Locations are cleared row by row: shelf/layer/bin bins and coater staging stay.
if (LOCATIONS_TABLE !== 'locations' || EMPTY.includes('locations') || KEEP.includes('locations')) {
  fail('locations must be partly cleared, not truncated or kept whole');
}
// Every table that points at locations must be emptied, or deleting a location is refused.
for (const table of ['location_tray', 'cutter_build_locations', 'cutter_body_shelf_placements', 'container_sets']) {
  if (!EMPTY.includes(table)) fail(`${table} points at locations and must be emptied`);
}
// The kept pattern must be exactly the shelf tags the app accepts.
const shelfConstants = read('libs/manufacturing/shared/util-constants/src/lib/shelf-location.constants.ts');
const appPattern = (name) => {
  const match = new RegExp(`export const ${name} = /(.+)/;`).exec(shelfConstants);
  if (!match) fail(`${name} not found in shelf-location.constants.ts`);
  return new RegExp(match[1]);
};
const appShelfPatterns = [appPattern('CUTTERGRIND_BIN_SHELF_PATTERN'), appPattern('CUTTERGRIND_ROUGH_SHELF_PATTERN')];
const kept = new RegExp(KEPT_SHELF_LOCATION_PATTERN);
const samples = [];
for (const prefix of ['CGDR', 'CGDP', 'CGFR', 'CGFP', 'CGRR', 'CGRP', 'CGXX', 'GSR', 'GSP']) {
  for (const position of ['A1A', 'Z9Z', 'B3C', 'A0A', 'A1', 'AA1A', 'a1a', '001', '1010']) samples.push(`${prefix}-${position}`);
}
samples.push('CGDRA1A', 'CGDR-A1A ', 'COATER-STAGING', 'CGDR');
for (const sample of samples) {
  const app = appShelfPatterns.some((pattern) => pattern.test(sample));
  if (kept.test(sample) !== app) fail(`Kept-location pattern disagrees with the app shelf patterns for "${sample}"`);
}
if (!kept.test('CGDR-A1A') || kept.test('CGDR-001') || kept.test('GSR-1010')) fail('Kept-location pattern is wrong');
if (!KEPT_LOCATION_SERIALS.includes('COATER-STAGING')) fail('COATER-STAGING must be kept');
if (!script.includes('await client.query(`DELETE FROM public.locations WHERE NOT (${kept.where})`, kept.params);') ||
    !script.includes("upper(serial_number) ~ $1 OR upper(serial_number) = ANY($2::text[])")) {
  fail('Locations must be deleted with bound parameters, keeping the shelf/layer/bin pattern');
}

// --locations= chooses keep-shelves (default) or delete-all; anything else is refused.
if (DEFAULT_LOCATION_MODE !== 'keep-shelves' || Object.keys(LOCATION_MODES).join() !== 'keep-shelves,delete-all') {
  fail('Location modes must be keep-shelves (default) and delete-all');
}
if (parseLocationMode([]) !== 'keep-shelves' || parseLocationMode(['--locations=delete-all']) !== 'delete-all') {
  fail('parseLocationMode reads --locations=');
}
let unknownRefused = false;
try { parseLocationMode(['--locations=everything']); } catch { unknownRefused = true; }
if (!unknownRefused) fail('An unknown --locations= value must be refused');

// Tables a database has beyond the lists (left by older releases) that point at an emptied
// table, directly or through another, are found from the database's own foreign keys and
// emptied too; a kept or non-public one stops the run, as do rows still pointing at a
// location that would be deleted. Both are checked before anything is deleted.
for (const marker of [
  'WITH RECURSIVE deps(rel)', 'SELECT con.conrelid FROM pg_constraint con JOIN deps d ON con.confrelid = d.rel',
  "dep.schema !== 'public' || KEEP.includes(dep.table) || dep.table === LOCATIONS_TABLE",
  'const targets = [...empty, ...alsoEmpty];',
  'TRUNCATE TABLE ${targets.map(', 'await locationBlockers(client, locationMode, targets)',
  "throw new Error('The clear cannot run on this database as it is. Nothing was deleted.')",
]) {
  if (!script.includes(marker)) fail(`Clear command missing ${marker}`);
}
if (script.indexOf("throw new Error('The clear cannot run on this database") > script.indexOf("if (!apply) {")) {
  fail('Refused tables and location blockers must stop the preview, before anything is deleted');
}

// Every public table the API creates must be on one of the lists. A table left off both
// stays full; if it points at an emptied table, the TRUNCATE (no CASCADE) refuses and the
// whole clear fails.
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name) ? [full] : [];
  });
}
const created = new Set();
for (const file of ['libs', 'apps'].flatMap((dir) => sourceFiles(contractPath(process.cwd(), dir)))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [, name] of source.matchAll(/@Entity\(\s*(?:\{\s*name:\s*)?'([a-z0-9_]+)'/g)) created.add(name);
  for (const [, schema, name] of source.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:"?([a-z0-9_]+)"?\.)?"?([a-z0-9_]+)"?\s*\(/gi)) {
    if (!schema || schema === 'public') created.add(name);
  }
}
for (const table of ['container_sets', 'locations', 'users']) {
  if (!created.has(table)) fail(`Table scan did not find ${table}; the scan patterns are out of date`);
}
const unlisted = [...created]
  .filter((table) => !EMPTY.includes(table) && !KEEP.includes(table) && table !== LOCATIONS_TABLE).sort();
if (unlisted.length) fail(`Add these tables to EMPTY or KEEP in clear-operational-data.mjs: ${unlisted.join(', ')}`);

// No CASCADE: a kept table that still references an emptied one must stop the run, not lose rows.
if (/CASCADE/.test(script.replace(/\/\/.*$/gm, ''))) fail('The clear command must not truncate with CASCADE');
// Only public tables are touched; the Lapper schema keeps its history.
if (!script.includes("WHERE schemaname='public'") || !script.includes('TRUNCATE TABLE ${targets.map((table) => `public.${quoteIdent(table)}`)')) {
  fail('The clear command must only truncate tables in the public schema');
}
for (const marker of ["process.argv.includes('--apply')", 'CONFIRM_FLAG', "SET LOCAL lock_timeout", 'ROLLBACK', 'Kept tables changed', 'pre-clear-operational-data-manifest.json']) {
  if (!script.includes(marker)) fail(`Clear command missing ${marker}`);
}
if (!cmd.includes('Type CLEAR DATA to continue') || !cmd.includes(CONFIRM_FLAG)) {
  fail('The launcher must require the CLEAR DATA phrase before applying');
}
const cmdAt = (marker) => {
  const index = cmd.indexOf(marker);
  if (index < 0) fail(`CLEAR-OPERATIONAL-DATA.cmd missing ${marker}`);
  return index;
};
const cmdOrder = [
  'set /p LOCCHOICE=Choose 1 or 2 [1]: ',
  'clear-operational-data.mjs --locations=%LOCATIONS%\r\n',
  'Type CLEAR DATA to continue',
  `clear-operational-data.mjs --locations=%LOCATIONS% --apply ${CONFIRM_FLAG}`,
].map(cmdAt);
if (cmdOrder.some((index, i) => i > 0 && index < cmdOrder[i - 1])) {
  fail('CLEAR-OPERATIONAL-DATA.cmd must ask about locations, preview, then confirm before applying');
}
for (const marker of ['if "%LOCCHOICE%"=="1" set LOCATIONS=keep-shelves', 'if "%LOCCHOICE%"=="2" set LOCATIONS=delete-all', 'if not defined LOCATIONS (']) cmdAt(marker);
// Linux Docker host launcher: preview, typed phrase, verified backup, then apply with the API stopped.
const shAt = (marker) => {
  const index = sh.indexOf(marker);
  if (index < 0) fail(`CLEAR-OPERATIONAL-DATA.sh missing ${marker}`);
  return index;
};
const shOrder = [
  'read -r -p "Choose 1 or 2 [1]: " CHOICE',
  'run_clear || fail "Preview failed',
  'read -r -p "Type CLEAR DATA to continue: "',
  '[[ "$CONFIRM" != "CLEAR DATA" ]]',
  'pg_dump -U',
  "pg_restore --list",
  'chmod 600 "$BACKUP"',
  'compose stop "$API_SERVICE"',
  'run_clear --apply "$CONFIRM_FLAG"',
].map(shAt);
if (shOrder.some((index, i) => i > 0 && index < shOrder[i - 1])) {
  fail('CLEAR-OPERATIONAL-DATA.sh must preview, confirm, back up and stop the API before applying');
}
if (!sh.includes(`CONFIRM_FLAG="${CONFIRM_FLAG}"`)) fail('CLEAR-OPERATIONAL-DATA.sh must pass the confirm flag');
for (const marker of [
  'set -euo pipefail', 'umask 077', 'compose run --rm --no-deps -T', 'PROJECT="dana-apps"',
  '--locations=keep-shelves|--locations=delete-all) LOCATIONS="${arg#--locations=}" ;;',
  '1) LOCATIONS="keep-shelves" ;;', '2) LOCATIONS="delete-all" ;;',
  'node "$SCRIPT" "--locations=$LOCATIONS" "$@" </dev/null',
  'BACKUP_DIR="${MESHFORGE_BACKUP_DIR:-$HOME/dana-apps-backups}"',
  '-v "$ROOT/$SCRIPT_DIR:/app/$SCRIPT_DIR"',
  'trap restart_api EXIT', 'SCRIPT="$SCRIPT_DIR/clear-operational-data.mjs"',
  'SCRIPT_DIR="tools/manufacturing/data-import"',
]) shAt(marker);
if (!/^#!\/usr\/bin\/env bash\n/.test(sh) || sh.includes('\r')) fail('CLEAR-OPERATIONAL-DATA.sh must be a bash script with LF line endings');

if (pkg.scripts['clear:operational-data'] !== 'nx run manufacturing-tools:clear-operational-data' ||
    pkg.scripts['clear:operational-data:apply'] !== 'nx run manufacturing-tools:clear-operational-data-apply') {
  fail('npm scripts must call the manufacturing-tools targets');
}
if (project.targets['clear-operational-data']?.options?.command.includes('--apply')) fail('The default target must only preview');
if (!project.targets['clear-operational-data-apply']?.options?.command.includes(CONFIRM_FLAG)) fail('The apply target must pass the confirm flag');

console.log('[PASS] Clear operational data keeps users, base data and shelf bins and refuses to cascade.');
