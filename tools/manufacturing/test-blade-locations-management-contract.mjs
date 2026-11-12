import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { readMeshForgeStyles } from './lib/read-meshforge-styles.mjs';

const read=(p)=>fs.readFileSync(contractPath(process.cwd(), p),'utf8');

const routes=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/lib.routes.ts');
const nav=read('apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html');
const dashboard=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html');
const pageTs=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.ts');
const pageHtml=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html');
const bladeApi=read('libs/manufacturing/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts');
const locationService=read('libs/manufacturing/server/feat-location/src/lib/server-feat-location.service.ts');
const locationController=read('libs/manufacturing/server/feat-location/src/lib/server-feat-location.controller.ts');
const adminApi=read('libs/manufacturing/frontend/feature-admin-users/src/lib/admin-api.service.ts');
const adminTs=read('libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.ts');
const adminHtml=read('libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html');
const styles=readMeshForgeStyles();

for(const marker of [
  "path: 'locations'",
  "departmentEditorGuard('BLADE_TRACKING')",
  "./pages/locations/blade-locations.component",
]){
  if(!routes.includes(marker)) throw new Error(`Blade Locations route missing ${marker}`);
}

for(const marker of [
  'routerLink="/blades/locations"',
  '<span>Locations</span>',
]){
  if(!nav.includes(marker)) throw new Error(`Blade Locations sidebar missing ${marker}`);
}
if(!dashboard.includes('routerLink="locations"') || !dashboard.includes('danaOperationCard') || !dashboard.includes('heading="Blade Locations"')){
  throw new Error('Blade dashboard must expose the dedicated Blade Locations screen through the shared operation-card component.');
}

for(const marker of [
  'export class BladeLocationsComponent',
  'this.api.getLocations(page, 50)',
  'filteredLocations',
  'toggleLocation(locationId: string)',
  'toggleTray(trayId: string)',
  'response.meta.hasNextPage',
]){
  if(!pageTs.includes(marker)) throw new Error(`Blade Locations component missing ${marker}`);
}

for(const marker of [
  'danaPageHeader',
  'heading="Blade Locations"',
  'the trays physically assigned there',
  '*ngFor="let location of filteredLocations"',
  '*ngFor="let tray of location.trays"',
  '*ngFor="let blade of tray.blades"',
  'View contents',
  'View empty location',
  'Cutter shelf · trays not permitted',
]){
  if(!pageHtml.includes(marker)) throw new Error(`Blade Locations UI missing ${marker}`);
}
if(pageHtml.includes('| json') || pageHtml.includes('<pre')){
  throw new Error('Blade Locations must never render raw JSON/debug output.');
}

for(const marker of [
  'export interface InventoryLocationTrayRow',
  'blades: InventoryTrayBladeRow[]',
  'trays: InventoryLocationTrayRow[]',
]){
  if(!bladeApi.includes(marker)) throw new Error(`Blade location API model missing ${marker}`);
}

for(const marker of [
  'BladeTrayOrmEntity',
  'bladesByTray',
  'relations: {',
  'summary: true',
  'part_type: true',
  'blades:',
  'service_cycle: blade.service_cycle',
  'CutterBuildLocationOrmEntity',
  'assertLocationHasNoActivePlacements',
  'Move all trays/cutters out of this location before disabling it.',
  'Move all trays/cutters out of this location before changing its barcode or routing fields.',
  'parseSummaryShelfTag',
]){
  if(!locationService.includes(marker)) throw new Error(`Location backend missing ${marker}`);
}

const createBlock=locationController.slice(locationController.indexOf("@Post('')"), locationController.indexOf("@Get('')"));
const patchBlock=locationController.slice(locationController.indexOf("@Patch(':id')"), locationController.indexOf("@Delete(':id')"));
if(!createBlock.includes('@Auth([RoleType.ADMIN])') || !patchBlock.includes('@Auth([RoleType.ADMIN])')){
  throw new Error('Location create/update must remain ADMIN-only.');
}
if(!locationController.includes("@Get('')") || !locationController.includes('@Auth([RoleType.ADMIN, RoleType.USER])')){
  throw new Error('Location inventory list must remain readable by authenticated operators.');
}

for(const marker of [
  'export interface AdminLocationRow',
  'listLocations(page: number, perPage = 50)',
  "this.http.post<AdminLocationRow>('/api/v1/locations'",
  'updateLocation(',
  '`/api/v1/locations/${encodeURIComponent(id)}`',
]){
  if(!adminApi.includes(marker)) throw new Error(`Admin Location API missing ${marker}`);
}

for(const marker of [
  "'locations' | 'cutter-bodies'",
  'loadable<AdminLocationRow[]>([])',
  'saveLocation(): void',
  'beginEditLocation(location: AdminLocationRow)',
  'toggleLocationEnabled(location: AdminLocationRow',
  'parseSummaryShelfTag(this.locationForm.serial_number)',
  'this.loadLocations();',
]){
  if(!adminTs.includes(marker)) throw new Error(`Admin Locations component missing ${marker}`);
}

for(const marker of [
  "activeTab === 'locations'",
  '>Locations</button>',
  'Create Location',
  'Edit Location',
  'Existing Locations',
  'Shelf routing detected',
  'cannot be disabled',
]){
  if(!adminHtml.includes(marker)) throw new Error(`Admin Locations UI missing ${marker}`);
}

for(const marker of [
  '.blade-location-summary-grid',
  '.blade-location-tray-grid',
  '.blade-location-blade-list',
  '.gear-admin-location-rule',
  '.gear-admin-location-row',
]){
  if(!styles.includes(marker)) throw new Error(`Shared design system missing ${marker}`);
}

console.log('[PASS] Blade Locations/Admin Locations contract passed: all location/tray/blade relationships are browsable, location master data is admin-managed, summary shelf rules stay backend-authoritative, and occupied locations cannot be rerouted/disabled.');
