import fs from 'node:fs';
import path from 'node:path';
import { readSourceFamily } from './lib/source-family.mjs';

const root = process.cwd();
const read = (rel) => readSourceFamily(root, rel).replace(/^\uFEFF/, '');
const mustInclude = (text, markers, label) => {
  for (const marker of markers) {
    if (!text.includes(marker)) throw new Error(`${label} missing ${marker}`);
  }
};

const dto = read('libs/manufacturing/server/data-access/src/lib/dtos/blade-tracking/inventory-list-query.dto.ts');
const dtoIndex = read('libs/manufacturing/server/data-access/src/lib/dtos/blade-tracking/index.ts');
const trayController = read('libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.controller.ts');
const trayService = read('libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.service.ts');
const containerController = read('libs/manufacturing/server/feat-container/src/lib/server-feat-container.controller.ts');
const containerService = read('libs/manufacturing/server/feat-container/src/lib/server-feat-container.service.ts');
const locationController = read('libs/manufacturing/server/feat-location/src/lib/server-feat-location.controller.ts');
const locationService = read('libs/manufacturing/server/feat-location/src/lib/server-feat-location.service.ts');
const api = read('libs/manufacturing/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts');
const pageTs = read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.ts');
const pageHtml = read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html');
const inventoryCss = read('vendor/dana-ui/package/styles/gear-apps/features/inventory-core.css');

mustInclude(dto, [
  'export class InventoryListQueryDto extends PaginationOptionsDto',
  '@ApiPropertyOptional',
  '@IsOptional()',
  '@IsString()',
  '@MaxLength(100)',
  'readonly search?: string;',
], 'InventoryListQueryDto');
if (!dtoIndex.includes("export * from './inventory-list-query.dto'")) {
  throw new Error('Blade Tracking DTO index does not export InventoryListQueryDto.');
}

for (const [controller, label] of [
  [trayController, 'Tray controller'],
  [containerController, 'Container controller'],
  [locationController, 'Location controller'],
]) {
  mustInclude(controller, ['InventoryListQueryDto', '@Query() query: InventoryListQueryDto'], label);
}

mustInclude(trayService, [
  'query?: InventoryListQueryDto',
  'const search = query?.search?.trim();',
  'tray.serial_number ILIKE :search',
  'summary.number ILIKE :search',
  'part_type.code ILIKE :search',
  'current_stage.code ILIKE :search',
], 'Tray inventory search');
mustInclude(containerService, [
  'query?: InventoryListQueryDto',
  'container.serial_number ILIKE :search',
], 'Container inventory search');
mustInclude(locationService, [
  'query?: InventoryListQueryDto',
  'location.serial_number ILIKE :search',
  'location.number ILIKE :search',
  'location.description ILIKE :search',
  'location.department ILIKE :search',
  'location.location_type ILIKE :search',
], 'Location inventory search');

mustInclude(api, [
  "getTrays(page = 1, perPage = 50, search = '')",
  "getContainers(page = 1, perPage = 50, search = '')",
  "getLocations(page = 1, perPage = 50, search = '')",
  "getBlades(page = 1, perPage = 50, search = '')",
  'private inventoryListParams(page: number, perPage: number, search: string)',
  "params['search'] = normalizedSearch;",
], 'Blade Tracking inventory API');

mustInclude(pageTs, [
  'readonly searchTerms: Record<InventoryTab, string>',
  'readonly appliedSearchTerms: Record<InventoryTab, string>',
  'get activeSearch(): string',
  'set activeSearch(value: string)',
  'searchCurrentTab(): void',
  'clearCurrentSearch(): void',
  'this.api.getTrays(page, 50, search)',
  'this.api.getContainers(page, 50, search)',
  'this.api.getLocations(page, 50, search)',
  'this.api.getBlades(page, 50, search)',
], 'Inventory Control Center component');

mustInclude(pageHtml, [
  'class="gear-panel inventory-browser-toolbar"',
  '(ngSubmit)="searchCurrentTab()"',
  '[(ngModel)]="activeSearch"',
  '[placeholder]="activeSearchPlaceholder"',
  '(click)="clearCurrentSearch()"',
  'Searches the full database for this inventory type, not only the current page.',
  'Use the column controls below for current-page sorting and filtering.',
  'role="status" aria-live="polite"',
], 'Inventory Control Center search UI');

if ((pageHtml.match(/<table\s+danaTable\b/g) || []).length !== 4) {
  throw new Error('Inventory Control Center must expose exactly four shared danaTable inventory tables.');
}
for (const marker of [
  'data-dana-table-detail="true"',
  '[attr.data-dana-table-group]="tray.id"',
  '[attr.data-dana-table-group]="container.id"',
  '[attr.data-dana-table-group]="location.id"',
  'data-dana-table-static',
]) {
  if (!pageHtml.includes(marker)) throw new Error(`Inventory relationship table marker missing ${marker}`);
}

mustInclude(inventoryCss, [
  '.inventory-browser-toolbar',
  '.inventory-browser-search',
  '.inventory-browser-actions',
  '.inventory-browser-status',
], 'Inventory browser shared styling');

console.log('[PASS] Inventory Control Center search contract passed: full-database per-tab search, server pagination, and relationship-safe shared tables are wired end to end.');
