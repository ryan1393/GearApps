import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(contractPath(root, rel), 'utf8');
const fail = (message) => { console.error(`[FAIL] ${message}`); process.exit(1); };
const need = (text, marker, label) => { if (!text.includes(marker)) fail(`${label} missing marker: ${marker}`); };

const trayTsPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.ts';
const trayHtmlPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html';
const overviewTsPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.ts';
const overviewHtmlPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html';
const lookupHtmlPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html';
const locationsHtmlPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html';
const apiPath = 'libs/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts';
const containerServicePath = 'libs/server/feat-container/src/lib/server-feat-container.service.ts';
const relationStylePath = 'vendor/dana-ui/package/styles/gear-apps/features/inventory-relations.css';

const trayTs = read(trayTsPath);
const trayHtml = read(trayHtmlPath);
const overviewTs = read(overviewTsPath);
const overviewHtml = read(overviewHtmlPath);
const lookupHtml = read(lookupHtmlPath);
const locationsHtml = read(locationsHtmlPath);
const api = read(apiPath);
const containerService = read(containerServicePath);
const relationStyles = read(relationStylePath);

for (const marker of [
  '*ngFor="let assignment of d.blades"',
  'assignment.blade.serial_number',
  "assignment.blade.part_type?.code || trayPartType",
  '(click)="toggleBladeHistory(assignment.blade.id)"',
  'View history',
  'Blade History',
]) need(trayHtml, marker, trayHtmlPath);

for (const marker of [
  'toggleBladeHistory(bladeId: string)',
  'getBladeHistory(bladeId)',
  'historyByBladeId',
  'historyLoadingBladeId',
]) need(trayTs, marker, trayTsPath);

need(api, 'blades: InventoryTrayBladeRow[];', apiPath);
for (const marker of [
  'BladeTrayOrmEntity',
  'const bladesByTray = new Map<string, BladeTrayOrmEntity[]>();',
  'blades: (bladesByTray.get(tray.id) ?? []).map',
]) need(containerService, marker, containerServicePath);

for (const marker of [
  'toggleContainerTray(trayId: string)',
  'toggleLocationTray(trayId: string)',
  'expandedContainerTrayId',
  'expandedLocationTrayId',
]) need(overviewTs, marker, overviewTsPath);
for (const marker of [
  '(click)="toggleContainerTray(tray.id)"',
  '(click)="toggleLocationTray(tray.id)"',
  '*ngFor="let blade of tray.blades"',
]) need(overviewHtml, marker, overviewHtmlPath);

for (const marker of [
  '*ngFor="let t of c.trays"',
  '*ngFor="let b of t.blades"',
  'b.serial_number',
]) need(lookupHtml, marker, lookupHtmlPath);

for (const marker of [
  '(click)="toggleLocation(location.id)"',
  '(click)="toggleTray(tray.id)"',
  '*ngFor="let blade of tray.blades"',
]) need(locationsHtml, marker, locationsHtmlPath);

for (const marker of [
  '.inventory-child-section',
  '.inventory-child-stack',
  '.inventory-child-grid',
  '.inventory-child-card',
  '.inventory-child-card-header',
  '.inventory-child-list',
  '.inventory-child-row',
  '.inventory-child-empty',
]) need(relationStyles, marker, relationStylePath);

for (const marker of [
  'class="gear-panel inventory-child-section"',
  'class="inventory-child-section-header"',
]) need(trayHtml, marker, trayHtmlPath);

for (const marker of [
  'class="inventory-child-stack"',
  'class="inventory-child-card"',
  'class="inventory-child-list"',
]) need(lookupHtml, marker, lookupHtmlPath);

for (const marker of [
  'class="inventory-child-grid"',
  'class="inventory-child-card"',
  'class="inventory-child-list"',
]) need(overviewHtml, marker, overviewHtmlPath);

if (overviewHtml.includes('blade-location-tray-card')) {
  fail(`${overviewHtmlPath} must use the generic inventory-child drilldown vocabulary outside the Blade Locations feature.`);
}
if (lookupHtml.includes('class="rounded-xl border bg-white p-4"')) {
  fail(`${lookupHtmlPath} contains page-local child-card styling; use the shared inventory-child classes.`);
}


for (const [label, text] of [
  [trayHtmlPath, trayHtml],
  [overviewHtmlPath, overviewHtml],
  [lookupHtmlPath, lookupHtml],
  [locationsHtmlPath, locationsHtml],
]) {
  if (text.includes('| json') || text.includes('<pre')) fail(`${label} must not use raw/debug JSON for child drilldowns.`);
}

console.log('[PASS] Parent/child drilldown contract passed: Tray→Blade→History and Location/Container→Tray→Blade relationships are operator-visible.');
