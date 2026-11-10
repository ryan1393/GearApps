import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const ts=fs.readFileSync(
  contractPath(process.cwd(), 'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.ts'),
  'utf8',
);
const html=fs.readFileSync(
  contractPath(process.cwd(), 'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html'),
  'utf8',
);

if(html.includes('| json') || html.includes('<pre')){
  throw new Error('Inventory Lookup must not render raw API JSON.');
}

for(const marker of [
  '*ngIf="tray as t"',
  '*ngIf="container as c"',
  '*ngIf="location as l"',
  '{{ t.serial_number }}',
  '{{ t.blade_count }}',
  '{{ t.summary?.number',
  '{{ t.part_type?.code',
  '{{ t.current_stage?.name',
  '{{ c.serial_number }}',
  '{{ l.serial_number }}',
  '{{ l.department',
  'Current Placement',
  'c.trays.length',
  'l.trays.length',
]){
  if(!html.includes(marker)){
    throw new Error(`Inventory Lookup presentation is missing ${marker}`);
  }
}

for(const marker of [
  'get tray(): InventoryTrayRow | null',
  'get container(): InventoryContainerRow | null',
  'get location(): InventoryLocationRow | null',
  'this.message = null',
]){
  if(!ts.includes(marker)){
    throw new Error(`Inventory Lookup component is missing ${marker}`);
  }
}

console.log(
  '[PASS] Inventory Lookup UI contract passed: tray/container/location scans render physical placement and relationship details instead of raw JSON.',
);
