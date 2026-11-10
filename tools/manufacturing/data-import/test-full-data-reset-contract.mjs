import { contractPath } from '../lib/contract-paths.mjs';
import fs from 'node:fs';

const reset=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/data-import/reset-and-import-all-fresh.ps1'),'utf8');
const truncate=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/data-import/truncate-target-postgres.mjs'),'utf8');
const bootstrap=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/data-import/bootstrap-system-reference-data.mjs'),'utf8');
const seed=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/data-import/seed-trays-containers-mock-data.mjs'),'utf8');
const cmd=fs.readFileSync(contractPath(process.cwd(), 'commands/RESET-AND-REFRESH-ALL-DATA.cmd'),'utf8');
const pkg=JSON.parse(fs.readFileSync(contractPath(process.cwd(), 'package.json'),'utf8'));

for(const marker of [
  'Preflight fresh source export + validation (NO target changes)',
  '-YesReallyDeleteOldData',
  'Deleting old PostgreSQL application data',
  'Re-bootstrap required Gear Apps system reference data',
  'Importing the already-validated fresh base/reference snapshot',
  'Reconciling fresh cutter history against the new base data',
  'Importing fresh cutter history',
  'Recreating local Gear Apps operator/admin logins',
  'Final validation',
]) {
  if(!reset.includes(marker)) throw new Error(`Full reset workflow missing ${marker}`);
}

for(const marker of [
  "schemaname='public'",
  "new Set(['typeorm_metadata', 'migrations', 'spatial_ref_sys'])",
  'TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE',
  'pre-reset-target-manifest.json',
  'Target reset verification failed',
]) {
  if(!truncate.includes(marker)) throw new Error(`Target truncation helper missing ${marker}`);
}

if(!cmd.includes('Type DELETE OLD DATA to continue')) {
  throw new Error('Root reset CMD must require an explicit destructive confirmation phrase.');
}
if(!pkg.scripts?.['refresh:all-data:reset'] || !pkg.scripts?.['refresh:all-data:reset:apply']) {
  throw new Error('Package scripts for safe preflight/apply reset are missing.');
}
if(reset.indexOf('Preflight fresh source export + validation') > reset.indexOf('Deleting old PostgreSQL application data')) {
  throw new Error('Source preflight must run before target deletion.');
}
if(reset.indexOf('Re-bootstrap required Gear Apps system reference data') >
   reset.indexOf('Importing the already-validated fresh base/reference snapshot')) {
  throw new Error('System references must be restored before the base-data importer runs.');
}
for(const marker of [
  "table: 'part_types'",
  "['RING', 'Ring'",
  "['PINION', 'Pinion'",
  "table: 'tray_stages'",
  "table: 'cutter_build_statuses'",
  'System reference data bootstrapped after target reset',
]){
  if(!bootstrap.includes(marker)) throw new Error(`System-reference bootstrap missing ${marker}`);
}


for(const marker of [
  'const TRAY_COUNT = 300',
  'const CONTAINER_COUNT = 100',
  'const MOCK_SUMMARY_SETS = 12',
  'const MOCK_CONTAINER_LOADS = 10',
  "const TRAY_PREFIX = 'T'",
  "const CONTAINER_PREFIX = 'C'",
  "pt.code IN ('RING','PINION')",
  "CGD${cuttergrindPartLetter}-${summary}",
  "CGF${cuttergrindPartLetter}-${summary}",
  "requirement.part_type_code === 'RING' ? 'GSR-' : 'GSP-'",
  "'WAITING_FOR_GRINDING'",
  "'READY_FOR_CUTTER'",
  "'AT_COATER'",
  "'waiting_for_grinding'",
  "'returned_from_coating'",
  "'at_coater'",
  'populateGreenShedShelf',
  'Green Shed cutter shelves with mock cutter builds',
  'Mock inventory spans',
  'Remaining managed T/C records stay empty',
]){
  if(!seed.includes(marker)) throw new Error(`T/C mock-data seed missing ${marker}`);
}

if(seed.includes('substring(t.serial_number from 6)') ||
   seed.includes('substring(c.serial_number from 11)')){
  throw new Error('T/C mock seed contains an obsolete long-prefix substring offset.');
}
if(!seed.includes("substring(serial_number from 2)::int")){
  throw new Error('T/C mock seed must parse T0001/C0001 numeric suffixes from character 2.');
}

if(reset.indexOf('Seeding reusable T/C inventory with mixed mock data') >
   reset.indexOf('Final validation')){
  throw new Error('T/C mock data must be seeded before final validation.');
}


console.log('[PASS] Full data reset contract passed: source is staged/validated before destructive target reset, then fresh base/history are restored.');

