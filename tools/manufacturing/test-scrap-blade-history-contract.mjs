import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { readGearAppsStyles } from './lib/read-gear-apps-styles.mjs';

const read = (path) => fs.readFileSync(contractPath(process.cwd(), path), 'utf8').replace(/^\uFEFF/, '');

const routes = read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/lib.routes.ts');
const nav = read('apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html');
const pageTs = read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/scrap-blades/scrap-blades.component.ts');
const pageHtml = read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/scrap-blades/scrap-blades.component.html');
const api = read('libs/manufacturing/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts');
const queryDto = read('libs/manufacturing/server/data-access/src/lib/dtos/blade-tracking/blades/blade-list-query.dto.ts');
const bladeController = read('libs/manufacturing/server/feat-blade/src/lib/server-feat-blade.controller.ts');
const bladeService = read('libs/manufacturing/server/feat-blade/src/lib/server-feat-blade.service.ts');
const trayService = read('libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.service.ts');
const cutterBuildService = read('libs/manufacturing/server/feat-cutter-build/src/lib/server-feat-cutter-build.service.ts');
const sharedStyles = readGearAppsStyles();
const manifest = JSON.parse(read('tools/manufacturing/api-route-manifest.json'));

for (const marker of [
  "path: 'scrap-blades'",
  "departmentEditorGuard('BLADE_TRACKING')",
  'scrap-blades.component',
]) {
  if (!routes.includes(marker)) throw new Error(`Scrap blade route missing ${marker}`);
}

for (const marker of ['/blades/scrap-blades', 'Scrap / Discarded']) {
  if (!nav.includes(marker)) throw new Error(`Blade Tracking sidebar missing ${marker}`);
}

for (const marker of [
  'danaPageHeader',
  'heading="Scrap / Discarded Blades"',
  'Scrapped Blade Records',
  'View history',
  'Complete Blade History',
  'event.occurred_at',
  'event.tray_serial_number',
  'event.container_serial_number',
  'event.actor',
  'event.notes',
]) {
  if (!pageHtml.includes(marker)) throw new Error(`Scrap blade UI missing ${marker}`);
}

if (pageHtml.includes('| json') || pageHtml.includes('<pre') || pageHtml.includes('JSON.stringify')) {
  throw new Error('Scrap blade screen must never render raw/debug JSON.');
}

for (const marker of [
  'getScrappedBlades(page = 1, perPage = 50, search = \'\')',
  'status: BladeStatus.SCRAPPED',
  'getBladeHistory(bladeId: string)',
  'export interface BladeHistoryView',
  'scrap_details:',
]) {
  if (!api.includes(marker)) throw new Error(`BladeTrackingApiService missing ${marker}`);
}

for (const marker of [
  'search(): void',
  'clearSearch(): void',
  'toggleHistory(blade: InventoryBladeRow): void',
  'this.api.getBladeHistory(blade.id)',
  'eventLabel(value: string)',
  ".replace(/_/g, ' ')",
]) {
  if (!pageTs.includes(marker)) throw new Error(`Scrap blade component missing ${marker}`);
}

for (const marker of [
  'readonly status?: BladeStatus',
  'readonly search?: string',
  '@IsEnum(BladeStatus)',
  '@MaxLength(100)',
]) {
  if (!queryDto.includes(marker)) throw new Error(`Blade list query DTO missing ${marker}`);
}

for (const marker of [
  'async getBlades(@Query() query: BladeListQueryDto)',
  "@Get(':id/history')",
  '@Auth([RoleType.ADMIN, RoleType.USER])',
]) {
  if (!bladeController.includes(marker)) throw new Error(`Blade controller missing ${marker}`);
}

for (const marker of [
  'query?.status === BladeStatus.SCRAPPED',
  'blade.status = :status',
  'blade.serial_number ILIKE :search',
  'summary.number ILIKE :search',
  'part_type.code ILIKE :search',
  'event_type: BladeHistoryEvent.SCRAPPED',
  'scrap_details:',
  'occurred_at: scrap.createdAt',
  'tray_serial_number:',
  'async getBladeHistory(bladeId: Uuid)',
  'relations: { createdByUser: true }',
  'container_serial_number:',
  'actor:',
]) {
  if (!bladeService.includes(marker)) throw new Error(`Blade service missing ${marker}`);
}

for (const marker of [
  'BladeHistoryEvent.SCRAPPED',
  "notes: 'Scrapped during grinding'",
]) {
  if (!trayService.includes(marker)) throw new Error(`Grinding scrap history missing ${marker}`);
}

for (const marker of [
  'BladeHistoryEvent.SCRAPPED',
  'Scrapped during cutter teardown',
]) {
  if (!cutterBuildService.includes(marker)) throw new Error(`Cutter teardown scrap history missing ${marker}`);
}

for (const marker of [
  '.scrap-blades-heading',
  '.scrap-summary-row',
  '.scrap-history-timeline',
  '.scrap-history-event-danger',
]) {
  if (!sharedStyles.includes(marker)) throw new Error(`Shared Gear Apps stylesheet missing ${marker}`);
}

if (manifest.length !== 113) {
  throw new Error(`Scrap/history screen should reuse existing blade routes; expected 113 API routes, found ${manifest.length}`);
}

const historyRoute = manifest.find((route) => route.method === 'GET' && route.path === '/api/v1/blades/:id/history');
if (!historyRoute) throw new Error('Existing GET /api/v1/blades/:id/history route must remain available.');

console.log('[PASS] Scrap / Discarded Blades contract passed: SCRAPPED filtering/search, readable scrap details, full lifecycle history drill-in, shared styling, and the current 113-route API contract are preserved.');
