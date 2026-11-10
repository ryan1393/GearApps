import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const script=fs.readFileSync(contractPath(process.cwd(), 'tools/test-post-workflow-db-integrity.mjs'),'utf8');

const requiredTables=[
  'trays','blade_tray','blades','container_tray','location_tray',
  'cutter_machine_runs','cutter_builds','cutter_bodies'
];
for(const table of requiredTables){
  if(!script.includes(table)) throw new Error(`Integrity test is missing table coverage: ${table}`);
}

for(const invariant of [
  'blade_count matches active blade assignments',
  'not actively assigned to multiple trays',
  'matches tray summary and part type',
  'not simultaneously active in a container and a location',
  'machine has at most one active cutter run',
  'Completed E2E build has no active machine run',
  'E2E cutter body has at most one open build',
]){
  if(!script.includes(invariant)) throw new Error(`Integrity test is missing invariant: ${invariant}`);
}

if(!script.includes("serial_number like 'E2E-%'") || !script.includes("build_number like '%E2E%'")){
  throw new Error('Integrity test must remain scoped to dedicated E2E records.');
}

console.log('[PASS] Post-workflow DB integrity/reconciliation contract passed.');
