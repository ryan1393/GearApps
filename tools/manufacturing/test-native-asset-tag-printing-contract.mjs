import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(contractPath(process.cwd(), p),'utf8').replace(/^\uFEFF/,'');
const manifest=JSON.parse(read('tools/manufacturing/api-route-manifest.json'));

const controller=read('libs/manufacturing/server/feat-tray/src/lib/server-feat-asset-tag.controller.ts');
const service=read('libs/manufacturing/server/feat-tray/src/lib/server-feat-asset-tag.service.ts');
const dto=read('libs/manufacturing/server/feat-tray/src/lib/asset-tag-print.dto.ts');
// The label itself and the printer transport moved out of the service when printers became a list
// chosen in Admin, each speaking IPL or ZPL.
const label=read('libs/manufacturing/server/feat-tray/src/lib/label-printers/asset-tag-label.ts');
const printers=read('libs/manufacturing/server/feat-tray/src/lib/label-printers/label-printer.service.ts');
const printerSchema=read('libs/manufacturing/server/feat-tray/src/lib/label-printers/label-printer-schema.ts');
const trayService=read('libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.service.ts');
const containerService=read('libs/manufacturing/server/feat-container/src/lib/server-feat-container.service.ts');
const api=read('libs/manufacturing/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts');
const lookupTs=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.ts');
const lookupHtml=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html');
const inventoryTs=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.ts');
const inventoryHtml=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html');
const locationsTs=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.ts');
const locationsHtml=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html');
const trayTs=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.ts');
const trayHtml=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html');
const adminApi=read('libs/manufacturing/frontend/feature-admin-users/src/lib/admin-api.service.ts');
const adminTs=read('libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.ts');
const adminHtml=read('libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html');
const envExample=read('.env.example');
const configurePrinter=read('tools/manufacturing/configure-label-printer.ps1');
const printDoc=read('docs/manufacturing/printing/ASSET-TAG-IPL.md');

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

requireText(dto, "['TRAY', 'CONTAINER', 'LOCATION', 'LOCATION_SUMMARY']", 'asset tag DTO');
requireText(dto, 'record_id!: string', 'asset tag DTO database-record identity');
forbidText(dto, 'serial_number!:', 'asset tag DTO client-supplied serial');

requireText(service, 'this.getAssetById(kind, dto.record_id)', 'database record lookup');
requireText(service, 'asset.serial_number.trim().toUpperCase()', 'database-backed printable serial');
// A location's summary tag prints the Summary and part type stored on the location, never ones the caller sends.
requireText(service, "relations: { summary: true, part_type: true }", 'database-backed location summary tag');
requireText(service, '`${location.summary.number}-${location.part_type.code}`', 'location summary tag value');
requireText(service, "!/^T[0-9]{4,}$/.test(serialNumber)", 'tray stored serial rule');
requireText(service, "!/^C[0-9]{4,}$/.test(serialNumber)", 'container stored serial rule');
requireText(label, 'export const ASSET_TAG_WIDTH_DOTS = 431', '2.125 inch label width');
requireText(label, 'export const ASSET_TAG_HEIGHT_DOTS = 127', '0.625 inch label height');
requireText(label, 'W${ASSET_TAG_WIDTH_DOTS}', 'IPL print width');
requireText(label, 'c6;i0;d3,${serial}', 'IPL Code 128 field');
requireText(label, 'c26;r0;b0;d3,${serial}', 'IPL human-readable field');
requireText(label, '^PW${ASSET_TAG_WIDTH_DOTS}', 'ZPL print width');
// The label length is left to the printer's media calibration; the tag is positioned from its measured registration.
requireText(label, 'const ZPL_REGISTRATION: LabelAdjustment = { right: 23, down: 20 }', 'measured ZPL registration');
requireText(label, '^BCN,${BARCODE_HEIGHT_DOTS},N,N,N,N^FD${serial}^FS', 'ZPL Code 128 field');
requireText(service, "buildAssetTag(language, serialNumber, { right: printer?.offset_right ?? 0, down: printer?.offset_down ?? 0 })", 'tag built in the printer language at its adjusted position');
requireText(service, "this.printers.resolve('ASSET_TAG', printerId)", 'chosen or default tag printer');
requireText(printers, 'GEAR_LABEL_PRINTER_HOST', 'environment fallback printer');
requireText(printers, "labelType === 'ASSET_TAG' ? this.environmentPrinter() : null", 'environment printer is the tag fallback only');
requireText(printerSchema, "language text NOT NULL CHECK (language IN ('IPL','ZPL'))", 'printer language');
requireText(printerSchema, 'ON public.gear_label_printers (label_type) WHERE is_default', 'one default printer per label');
requireText(printerSchema, 'ADD COLUMN IF NOT EXISTS offset_right integer NOT NULL DEFAULT 0', 'per-printer position adjustment added to an existing table');
requireText(printerSchema, 'ADD COLUMN IF NOT EXISTS offset_down integer NOT NULL DEFAULT 0', 'per-printer position adjustment added to an existing table');
requireText(service, "payload.toString('base64')", 'native tag file fallback');
for(const forbidden of ['TRAY-','CONT-','CONTAINER-']) { forbidText(service, forbidden, 'native label generator'); forbidText(label, forbidden, 'native label generator'); }

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
requireText(adminHtml, "printTag('LOCATION_SUMMARY', location.id,", 'Admin location Print Summary Tag');
requireText(locationsHtml, "printTag('LOCATION_SUMMARY', location.id, summary)", 'Blade Locations Print Summary Tag');

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
if(manifest.length!==125) throw new Error(`Expected 125 API routes with native asset tag printing; found ${manifest.length}`);

console.log('[PASS] Native asset-tag printing contract passed: database-backed serial identity, T/C zero-padding, 2.125 x 0.625 IPL stock, Code 128, Admin per-record Print Tag, authenticated transport, and PRN fallback.');
