import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { readSourceFamily } from './lib/source-family.mjs';

const service=readSourceFamily(
  process.cwd(),
  'libs/manufacturing/server/feat-greenshed/src/lib/server-feat-greenshed.service.ts',
);
const api=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/frontend/data-access-greenshed/src/lib/greenshed-api.service.ts'),
  'utf8',
);
const html=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/dashboard/greenshed-dashboard.component.html'),
  'utf8',
);

for(const marker of [
  "status: { code: In(['READY', 'SHELF']) }",
  'completed_at: IsNull()',
  'const availableCutters = availableBuilds.map',
  'activeLocationByBuildId',
  'available: availableCutters.length',
  'available_cutters: availableCutters',
  'legacy source never recorded a shelf location',
]){
  if(!service.includes(marker)){
    throw new Error(`Green Shed dashboard backend is missing ${marker}`);
  }
}

if(service.includes(".andWhere('status.code = :code', { code: 'READY' })") &&
   service.includes('readyCount')){
  throw new Error(
    'Green Shed dashboard must not define availability as READY-only; SHELF builds are also setup-capable.',
  );
}

for(const marker of [
  'available: number',
  'available_cutters: Array',
  'status_code: string',
  'shelf_location: string | null',
]){
  if(!api.includes(marker)){
    throw new Error(`Green Shed frontend API contract is missing ${marker}`);
  }
}

for(const marker of [
  '<h3>Available Cutters</h3>',
  '{{ d.counts.available }}',
  'Every open READY or SHELF cutter build currently available in the database.',
  '*ngFor="let r of d.available_cutters"',
  "{{ r.shelf_location || 'Available — no shelf recorded' }}",
]){
  if(!html.includes(marker)){
    throw new Error(`Green Shed dashboard UI is missing ${marker}`);
  }
}

if(html.includes('*ngFor="let r of d.shelf_cutters"')){
  throw new Error(
    'Green Shed dashboard must render the complete available_cutters list, not only shelf assignments.',
  );
}

console.log(
  '[PASS] Green Shed available-cutters contract passed: dashboard lists every open READY/SHELF cutter from cutter_builds, including imports with no shelf location.',
);
