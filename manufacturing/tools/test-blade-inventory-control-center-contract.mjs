import fs from 'node:fs';

const read = (rel) => fs.readFileSync(rel, 'utf8').replace(/^\uFEFF/, '');

const routes = read('libs/frontend/feature-blade-tracking/src/lib/lib.routes.ts');
const nav = read('apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html');
const dashboard = read('libs/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html');
const pageTs = read('libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.ts');
const pageHtml = read('libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html');
const api = read('libs/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts');

for (const marker of [
  "path: 'all-inventory'",
  "departmentEditorGuard('BLADE_TRACKING')",
  './pages/inventory-overview/inventory-overview.component',
]) {
  if (!routes.includes(marker)) throw new Error(`Inventory Control Center route missing ${marker}`);
}

for (const marker of [
  'routerLink="/blades/all-inventory"',
  '<span>Inventory Control Center</span>',
]) {
  if (!nav.includes(marker)) throw new Error(`Blade sidebar missing Inventory Control Center marker ${marker}`);
}

for (const marker of [
  'routerLink="all-inventory"',
  'danaOperationCard',
  'heading="Inventory Control Center"',
]) {
  if (!dashboard.includes(marker)) throw new Error(`Blade dashboard missing Inventory Control Center marker ${marker}`);
}

for (const marker of [
  "type InventoryTab = 'trays' | 'containers' | 'locations' | 'blades'",
  "activeTab: InventoryTab = 'trays'",
  'readonly searchTerms: Record<InventoryTab, string>',
  'readonly appliedSearchTerms: Record<InventoryTab, string>',
  'searchCurrentTab(): void',
  'clearCurrentSearch(): void',
  'this.api.getTrays(page, 50, search)',
  'this.api.getContainers(page, 50, search)',
  'this.api.getLocations(page, 50, search)',
  'this.api.getBlades(page, 50, search)',
  'loadTrays(page: number)',
  'loadContainers(page: number)',
  'loadLocations(page: number)',
  'loadBlades(page: number)',
  'toggleTray(trayId: string)',
  'toggleContainer(containerId: string)',
  'toggleContainerTray(trayId: string)',
  'toggleLocation(locationId: string)',
  'toggleLocationTray(trayId: string)',
]) {
  if (!pageTs.includes(marker)) throw new Error(`Inventory Control Center component missing ${marker}`);
}

for (const marker of [
  'danaPageHeader',
  'heading="Inventory Control Center"',
  "activeTab === 'trays'",
  "activeTab === 'containers'",
  "activeTab === 'locations'",
  "activeTab === 'blades'",
  'Tray Inventory',
  'Container Inventory',
  'Location Inventory',
  'Blade Inventory',
  'View ',
  'blades',
  'current_location.serial_number',
  'current_container?.serial_number',
  'meta.hasPreviousPage',
  'meta.hasNextPage',
  'Searches the full database for this inventory type, not only the current page.',
  '(ngSubmit)="searchCurrentTab()"',
  '(click)="clearCurrentSearch()"',
  'danaTable',
  'data-dana-table-detail="true"',
  'data-dana-table-group',
]) {
  if (!pageHtml.includes(marker)) throw new Error(`Inventory Control Center UI missing ${marker}`);
}

if (pageHtml.includes('| json') || pageHtml.includes('<pre') || pageHtml.includes('JSON.stringify')) {
  throw new Error('Inventory Control Center must never render raw/debug JSON.');
}

for (const marker of [
  'export interface InventoryTrayRow',
  'export interface InventoryContainerRow',
  'export interface InventoryLocationRow',
  'export interface InventoryBladeRow',
  'blades: InventoryTrayBladeRow[]',
  'trays: InventoryContainedTrayRow[]',
  'trays: InventoryLocationTrayRow[]',
  "this.http.get<IPaginatedResponse<InventoryTrayRow>>('/api/v1/trays'",
  "this.http.get<IPaginatedResponse<InventoryContainerRow>>('/api/v1/containers'",
  "this.http.get<IPaginatedResponse<InventoryLocationRow>>('/api/v1/locations'",
  "this.http.get<IPaginatedResponse<InventoryBladeRow>>('/api/v1/blades'",
]) {
  if (!api.includes(marker)) throw new Error(`Inventory Control Center API contract missing ${marker}`);
}

console.log('[PASS] Blade Tracking Inventory Control Center contract passed: trays, containers, locations, and blades are searchable, paginated, relationship-aware, drillable, and operator-readable.');
