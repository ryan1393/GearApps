import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(contractPath(process.cwd(), p),'utf8').replace(/^\uFEFF/,'');
const manifest=JSON.parse(read('tools/api-route-manifest.json'));

const controller=read('libs/server/feat-tray/src/lib/server-feat-asset-tag.controller.ts');
const service=read('libs/server/feat-tray/src/lib/server-feat-asset-tag.service.ts');
const dto=read('libs/server/feat-tray/src/lib/asset-tag-print.dto.ts');
const trayService=read('libs/server/feat-tray/src/lib/server-feat-tray.service.ts');
const containerService=read('libs/server/feat-container/src/lib/server-feat-container.service.ts');
const api=read('libs/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts');
const lookupTs=read('libs/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.ts');
const lookupHtml=read('libs/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html');
const inventoryTs=read('libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.ts');
const inventoryHtml=read('libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html');
const locationsTs=read('libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.ts');
const locationsHtml=read('libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html');
const trayTs=read('libs/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.ts');
const trayHtml=read('libs/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html');
const adminApi=read('libs/frontend/feature-admin-users/src/lib/admin-api.service.ts');
const adminTs=read('libs/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.ts');
const adminHtml=read('libs/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html');
const envExample=read('.env.example');
const configurePrinter=read('tools/configure-label-printer.ps1');
const printDoc=read('docs/printing/ASSET-TAG-IPL.md');

function requireText(text, marker, label){
  if(!text.includes(marker)) throw new Error(`${label} missing ${marker}`);
}
function forbidText(text, marker, label){
  if(text.includes(marker)) throw new Error(`${label} must not contain ${marker}`);
}

requireText(controller, "@Controller({ path: 'asset-tags', version: '1' })", 'asset tag controller');
requireText(controller, "@Post('print')", 'asset tag controller');
requireText(controller, "@DepartmentAppEdit('BLADE_TRACKING')", 'asset tag controller');
requireText(controller, '@Auth([RoleType.ADMIN, RoleType.USER])', 'asset tag controller');

requireText(dto, "['TRAY', 'CONTAINER', 'LOCATION']", 'asset tag DTO');
requireText(dto, 'record_id!: string', 'asset tag DTO database-record identity');
forbidText(dto, 'serial_number!:', 'asset tag DTO client-supplied serial');

requireText(service, 'this.getAssetById(kind, dto.record_id)', 'database record lookup');
requireText(service, 'asset.serial_number.trim().toUpperCase()', 'database-backed printable serial');
requireText(service, "!/^T[0-9]{4,}$/.test(serialNumber)", 'tray stored serial rule');
requireText(service, "!/^C[0-9]{4,}$/.test(serialNumber)", 'container stored serial rule');
requireText(service, 'private readonly labelWidthDots = 431', '2.125 inch label width');
requireText(service, 'private readonly labelHeightDots = 127', '0.625 inch label height');
requireText(service, 'W${this.labelWidthDots}', 'IPL print width');
requireText(service, 'L${this.labelHeightDots}', 'IPL label height');
requireText(service, 'c6;i0;d3,${serialNumber}', 'IPL Code 128 field');
requireText(service, 'd3,${serialNumber}', 'IPL human-readable field');
requireText(service, 'GEAR_LABEL_PRINTER_HOST', 'printer transport');
requireText(service, "payload.toString('base64')", 'native PRN fallback');
for(const forbidden of ['TRAY-','CONT-','CONTAINER-']) forbidText(service, forbidden, 'native label generator');

for(const [source, prefix, label] of [
  [trayService, 'T', 'tray'],
  [containerService, 'C', 'container'],
]) {
  requireText(source, "padStart(4, '0')", `${label} zero-padding`);
  requireText(source, `normalizeSequentialSerial('${prefix}'`, `${label} serial normalization`);
}
requireText(trayService, 'serial_number: serialNumber', 'tray persists normalized serial');
requireText(containerService, 'serial_number: serialNumber', 'container persists normalized serial');

requireText(api, "'/api/v1/asset-tags/print'", 'BladeTrackingApiService');
requireText(api, 'record_id: recordId', 'BladeTrackingApiService database ID request');
requireText(api, 'downloadAssetTagPrn', 'BladeTrackingApiService');
requireText(lookupTs, 'printingTagSerial: string | null = null;', 'Find Inventory print-state field');
for(const source of [lookupTs, inventoryTs, locationsTs, trayTs]) {
  requireText(source, 'recordId: string, serialNumber: string', 'Blade Tracking print handler');
  requireText(source, 'printAssetTag(kind, recordId)', 'Blade Tracking record ID print request');
}
for(const marker of [
  "printTag('TRAY', t.id, t.serial_number)",
  "printTag('CONTAINER', c.id, c.serial_number)",
  "printTag('LOCATION', l.id, l.serial_number)",
]) requireText(lookupHtml, marker, 'Find Inventory template');
for(const marker of [
  "printTag('TRAY', tray.id, tray.serial_number)",
  "printTag('CONTAINER', container.id, container.serial_number)",
  "printTag('LOCATION', location.id, location.serial_number)",
]) requireText(inventoryHtml, marker, 'Inventory Control Center template');
requireText(locationsHtml, "printTag('LOCATION', location.id, location.serial_number)", 'Blade Locations template');
requireText(locationsHtml, "printTag('TRAY', tray.id, tray.serial_number)", 'Blade Locations nested tray template');
requireText(trayHtml, "printTag('TRAY', d.tray.id, d.tray.serial_number)", 'Tray Contents template');

requireText(adminApi, 'listTrays(page: number', 'Admin tray list');
requireText(adminApi, 'listContainers(page: number', 'Admin container list');
requireText(adminApi, 'printAssetTag(kind: AssetTagKind, recordId: string)', 'Admin print API');
requireText(adminApi, 'record_id: recordId', 'Admin database-ID print request');
requireText(adminTs, "'trays' | 'containers' | 'locations'", 'Admin asset tabs');
requireText(adminTs, 'this.loadTrays();', 'Admin tray load');
requireText(adminTs, 'this.loadContainers();', 'Admin container load');
requireText(adminHtml, "(click)=\"printTag('TRAY', tray.id, tray.serial_number)\"", 'Admin tray Print Tag');
requireText(adminHtml, "(click)=\"printTag('CONTAINER', container.id, container.serial_number)\"", 'Admin container Print Tag');
requireText(adminHtml, "(click)=\"printTag('LOCATION', location.id, location.serial_number)\"", 'Admin location Print Tag');

for(const marker of [
  'GEAR_LABEL_PRINTER_HOST=',
  'GEAR_LABEL_PRINTER_PORT=9100',
  'GEAR_LABEL_PRINTER_TIMEOUT_MS=5000',
]) requireText(envExample, marker, '.env.example');
for(const marker of ['GEAR_LABEL_PRINTER_HOST','GEAR_LABEL_PRINTER_PORT','GEAR_LABEL_PRINTER_TIMEOUT_MS']) requireText(configurePrinter, marker, 'printer configuration helper');

for(const marker of [
  '2.25 in',
  '2.125 in',
  '0.625 in',
  '0.125 in',
]) requireText(printDoc, marker, 'asset-tag stock documentation');

const route=manifest.find((r)=>r.method==='POST' && r.path==='/api/v1/asset-tags/print');
if(!route) throw new Error('Route manifest missing POST /api/v1/asset-tags/print');
if(manifest.length!==113) throw new Error(`Expected 113 API routes with native asset tag printing; found ${manifest.length}`);

console.log('[PASS] Native asset-tag printing contract passed: database-backed serial identity, T/C zero-padding, 2.125 x 0.625 IPL stock, Code 128, Admin per-record Print Tag, authenticated transport, and PRN fallback.');
