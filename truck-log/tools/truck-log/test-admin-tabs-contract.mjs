import fs from 'node:fs';
import { readCssEntrySource, readFeatureSource } from './source-contract-utils.mjs';

const read = (path) => fs.readFileSync(path, 'utf8');
const adminPath = 'libs/truck-log/web/feature/admin/src/lib/admin.component.ts';
const cssPath = 'node_modules/@dana/ui/styles/dana-ui.css';

if (!fs.existsSync(adminPath)) throw new Error(`Missing ${adminPath}`);
if (!fs.existsSync(cssPath)) throw new Error(`Missing ${cssPath}`);

// Administration is split into one component per tab under the admin feature library.
const admin = readFeatureSource(process.cwd(), 'libs/truck-log/web/feature/admin/src/lib', ['.ts']);
const css = readCssEntrySource(process.cwd(), cssPath);

for (const marker of [
  'class="dana-tabs"',
  "activeAdminTab = 'drivers'",
  "activeAdminTab === 'drivers'",
  "activeAdminTab === 'carriers'",
  "activeAdminTab === 'locations'",
  "activeAdminTab === 'docks'",
  "activeAdminTab === 'alerts'",
  "activeAdminTab === 'schedule'",
  "activeAdminTab === 'workflow'",
  'Drivers <span class="dana-count-badge"',
  'Carriers <span class="dana-count-badge"',
  'Locations <span class="dana-count-badge"',
  'Scheduled loads <span class="dana-count-badge"',
  '<h2>Dock time alerts</h2>',
  '<h2>Operator flow</h2>',
  'class="dana-table-actions"',
  '(ngSubmit)="addDock()"',
  '(ngSubmit)="saveDockAging()"',
  'class="dana-dropzone"',
]) {
  if (!admin.includes(marker)) throw new Error(`Administration tab contract missing: ${marker}`);
}

for (const behavior of [
  'addDriver()', 'saveDriver(driver', 'toggleDriver(driver',
  'addCarrier()', 'saveCarrier(carrier', 'toggleCarrier(carrier',
  'addLocation()', 'saveLocation(location', 'toggleLocation(location',
  'addDock()', 'toggle(d', 'saveDockAging()', 'uploadSchedule()',
]) {
  if (!admin.includes(behavior)) throw new Error(`Existing Administration behavior missing: ${behavior}`);
}

if (/\bstyles\s*:\s*\[/.test(admin)) {
  throw new Error('Administration tabs must remain on the shared Truck Log stylesheet, not component-local styles.');
}

// Per-row edit copies: saving one row never discards other rows' edits; a failed save stays dirty with its error.
for (const marker of ['export class RowDrafts', 'edits.draft(driver).name', 'this.edits.failed(driver,', 'this.data.replaceDriver(saved)', 'edits.error(location)']) {
  if (!admin.includes(marker)) throw new Error(`Administration per-row editing missing: ${marker}`);
}
// Gate printing lives only in the dedicated Printing tab component.
const adminShell = read(adminPath);
if (/eastGatePrinter|saveGatePrinting|saveWorkstationGate/.test(adminShell)) throw new Error('Duplicate gate-printing code returned to admin.component.ts');
if (!adminShell.includes('<tl-gate-printing></tl-gate-printing>')) throw new Error('Printing tab must host the gate-printing component');

// Tab styling is Dana UI's.
for (const selector of ['.dana-tabs', '.dana-tab', '.dana-tab.is-active', '.dana-count-badge']) {
  if (!css.includes(selector)) throw new Error(`Dana UI tab CSS missing: ${selector}`);
}

console.log('[PASS] Truck Log Administration tab contract passed.');
