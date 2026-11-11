// The clear-operational-data command keeps users and base data and empties the rest.
import fs from 'node:fs';
import { contractPath } from '../lib/contract-paths.mjs';
import { CONFIRM_FLAG, EMPTY, KEEP } from './clear-operational-data.mjs';

const read = (relative) => fs.readFileSync(contractPath(process.cwd(), relative), 'utf8');
const script = read('tools/manufacturing/data-import/clear-operational-data.mjs');
const cmd = read('commands/CLEAR-OPERATIONAL-DATA.cmd');
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
for (const table of ['locations', 'trays', 'containers', 'blades', 'cutter_builds', 'dana_workflow_journal_v1']) {
  if (!EMPTY.includes(table)) fail(`${table} must be emptied`);
}
const overlap = EMPTY.filter((table) => KEEP.includes(table));
if (overlap.length) fail(`Tables on both lists: ${overlap.join(', ')}`);

// No CASCADE: a kept table that still references an emptied one must stop the run, not lose rows.
if (/CASCADE/.test(script.replace(/\/\/.*$/gm, ''))) fail('The clear command must not truncate with CASCADE');
// Only public tables are touched; the Lapper schema keeps its history.
if (!script.includes("WHERE schemaname='public'") || !script.includes('TRUNCATE TABLE ${empty.map((table) => `public.${quoteIdent(table)}`)')) {
  fail('The clear command must only truncate tables in the public schema');
}
for (const marker of ["process.argv.includes('--apply')", 'CONFIRM_FLAG', "SET LOCAL lock_timeout", 'ROLLBACK', 'Kept tables changed', 'pre-clear-operational-data-manifest.json']) {
  if (!script.includes(marker)) fail(`Clear command missing ${marker}`);
}
if (!cmd.includes('Type CLEAR DATA to continue') || !cmd.includes(CONFIRM_FLAG)) {
  fail('The launcher must require the CLEAR DATA phrase before applying');
}
if (cmd.indexOf('clear-operational-data.mjs\r\n') > cmd.indexOf('Type CLEAR DATA')) fail('The launcher must preview before asking');
if (pkg.scripts['clear:operational-data'] !== 'nx run manufacturing-tools:clear-operational-data' ||
    pkg.scripts['clear:operational-data:apply'] !== 'nx run manufacturing-tools:clear-operational-data-apply') {
  fail('npm scripts must call the manufacturing-tools targets');
}
if (project.targets['clear-operational-data']?.options?.command.includes('--apply')) fail('The default target must only preview');
if (!project.targets['clear-operational-data-apply']?.options?.command.includes(CONFIRM_FLAG)) fail('The apply target must pass the confirm flag');

console.log('[PASS] Clear operational data keeps users and base data and refuses to cascade.');
