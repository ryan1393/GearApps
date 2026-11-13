import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  componentStyleOffenders,
  readDanaUiStyles,
  readFeatureSource,
  readTruckLogStyles,
  DANA_UI_STYLES_ENTRY,
  TRUCK_LOG_STYLES_ENTRY,
} from './source-contract-utils.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

const appPath = 'apps/truck-log/src/app/app.component.ts';
const assetPath = 'apps/truck-log/src/assets/branding/dana-diamond.png';
const danaAssetPath = 'node_modules/@dana/ui/assets/branding/dana-diamond.png';

for (const rel of [appPath, assetPath, TRUCK_LOG_STYLES_ENTRY, DANA_UI_STYLES_ENTRY]) {
  if (!exists(rel)) throw new Error(`Missing UI polish contract file: ${rel}`);
}

const app = read(appPath);
if (!app.includes('class="dana-brand-mark"')) throw new Error('Truck Log shell is missing the Dana UI brand mark.');
if (!app.includes('<img src="assets/branding/dana-diamond.png" alt="">')) throw new Error('Truck Log shell is not using the local Dana Diamond asset.');
if (app.includes('class="brand-mark">TL</span>')) throw new Error('Old TL placeholder brand badge is still present.');

const sha256 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex').toUpperCase();
const assetHash = sha256(assetPath);
const expectedDanaHash = '6B3D9387F6E90C90B7E599E20853F09C3471C65B7756D648595AD1F58D1E03E9';
if (assetHash !== expectedDanaHash) {
  throw new Error(`Dana Diamond asset does not match the exact Gear Apps artwork. Got ${assetHash}`);
}
if (exists(danaAssetPath) && sha256(danaAssetPath) !== assetHash) {
  throw new Error('Truck Log Dana Diamond asset differs from the artwork shipped by @dana/ui.');
}

// Visual polish (buttons, hover states, panels, tables, toasts, dialogs, wide-screen rules) is owned by
// @dana/ui. Truck Log keeps layout-only CSS, loaded after Dana UI, and no component-local styles.
const project = JSON.parse(read('apps/truck-log/project.json'));
const buildStyles = project?.targets?.build?.options?.styles ?? [];
if (buildStyles[0] !== DANA_UI_STYLES_ENTRY) throw new Error(`Dana UI (${DANA_UI_STYLES_ENTRY}) must be the first stylesheet in the Truck Log build.`);
if (!read('apps/truck-log/src/styles.css').includes('truck-log.css')) throw new Error('apps/truck-log/src/styles.css must import the Truck Log layout styles.');

const css = readTruckLogStyles(root);
if (css.includes('\\n')) throw new Error('Truck Log CSS contains literal escaped-newline corruption.');
const opens = (css.match(/\{/g) || []).length;
const closes = (css.match(/\}/g) || []).length;
if (opens !== closes) throw new Error(`Truck Log CSS brace mismatch: ${opens}/${closes}`);
if (/!important/.test(css)) throw new Error('Truck Log layout CSS must not override Dana UI with !important.');

const offenders = componentStyleOffenders(root, ['apps/truck-log/src', 'libs/truck-log/web']);
if (offenders.length) throw new Error(`Components must not carry their own styles (Dana UI owns styling): ${offenders.join(', ')}`);

// Every Dana class used by a Truck Log template must exist in the Dana UI stylesheet.
const danaCss = readDanaUiStyles(root);
const templates = readFeatureSource(root, 'libs/truck-log/web', ['.ts', '.html']) + readFeatureSource(root, 'apps/truck-log/src', ['.ts', '.html']);
const usedDanaClasses = new Set();
for (const match of templates.matchAll(/\bclass="([^"]*)"/g)) for (const name of match[1].split(/\s+/)) if (name.startsWith('dana-')) usedDanaClasses.add(name);
for (const match of templates.matchAll(/\[class\.(dana-[\w-]+)\]/g)) usedDanaClasses.add(match[1]);
if (usedDanaClasses.size < 40) throw new Error(`Expected Truck Log templates to use Dana UI classes; found only ${usedDanaClasses.size}.`);
const undefinedDanaClasses = [...usedDanaClasses].filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(danaCss));
if (undefinedDanaClasses.length) throw new Error(`Templates use Dana classes that @dana/ui does not define: ${undefinedDanaClasses.join(', ')}`);

console.log('[PASS] Truck Log full UI polish + exact Dana Diamond contract passed.');

// Hover and focus treatment for actions comes from Dana UI primitives.
for (const requirement of [
  '.dana-btn:hover:not(:disabled)',
  '.dana-btn-success:hover:not(:disabled)',
  '.dana-btn-warning:hover:not(:disabled)',
]) {
  if (!danaCss.includes(requirement)) throw new Error(`Dana UI is missing interaction contract: ${requirement}`);
}

console.log('[PASS] Truck Log app-wide hover + action-alignment contract passed.');

const adminPath = 'libs/truck-log/web/feature/admin/src/lib/admin.component.ts';
if (!exists(adminPath)) throw new Error(`Missing Admin UI contract file: ${adminPath}`);
const admin = (function adminFeatureSource(){const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(d+'/'+e.name):e.name.endsWith('.ts')?[d+'/'+e.name]:[]);return walk('libs/truck-log/web/feature/admin/src/lib').sort().map((f)=>fs.readFileSync(f,'utf8')).join('\n');})() /* admin.component.ts + one component per tab */;

if (/\bstyles\s*:\s*\[/.test(admin)) {
  throw new Error('Administration must not carry a component-local style island; reference-data styling belongs to Dana UI.');
}

// Drivers, Carriers and Locations share one editable-table structure built from Dana UI classes.
for (const tab of ['drivers', 'carriers', 'locations']) {
  const source = read(`libs/truck-log/web/feature/admin/src/lib/tabs/admin-${tab}-tab.component.ts`);
  for (const marker of [
    'class="dana-filter-row"',
    'class="dana-table-shell"',
    'class="dana-table',
    'class="dana-table-actions"',
    'class="dana-input"',
    "[attr.data-tone]=\"edits.error(",
    "? 'danger' : (edits.dirty(",
    "? 'success' : 'neutral'\"",
    'Unsaved changes',
    'role="alert"',
  ]) {
    if (!source.includes(marker)) throw new Error(`Administration ${tab} is missing shared reference-data structure: ${marker}`);
  }
}

const checkInPath = 'libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts';
const historyPath = 'libs/truck-log/web/feature/history/src/lib/history.component.ts';
for (const rel of [checkInPath, historyPath]) {
  if (!exists(rel)) throw new Error(`Missing reference-data UI review file: ${rel}`);
}
const checkIn = readFeatureSource(process.cwd(), 'libs/truck-log/web/feature/check-in/src/lib', ['.ts', '.html']);
const history = read(historyPath);

if (!/<label for="checkin-driver-phone">Driver Phone<\/label><span class="dana-field-tag is-required">Required<\/span>/.test(checkIn)) throw new Error('Driver Phone is missing from the standard Required Check-In form.');
const referenceLookup = (label, options) => new RegExp(`<dana-combobox[^>]*\\[freeText\\]="true"[^>]*ariaLabel="${label}"[^>]*\\[options\\]="${options}"`).test(checkIn);
if (!referenceLookup('Driver name', 'referenceDrivers')) throw new Error('Driver reusable lookup is missing from the standard Check-In form control.');
if (!referenceLookup('Carrier', 'referenceCarriers')) throw new Error('Carrier reusable lookup is missing from the standard Check-In form control.');
if (!referenceLookup('Origin', 'referenceLocations') || !referenceLookup('Destination', 'referenceLocations')) throw new Error('Location reusable lookup is missing from the standard Check-In form control.');
if (!history.includes('<span class="dana-detail-label">Driver phone</span>')) throw new Error('Records detail is missing Driver Phone in the shared record-summary grid.');

console.log('[PASS] Truck Log Administration + Driver/Carrier/Location UI consistency contract passed.');

// ---------------------------------------------------------------------------
// Web review fixes: shared polling, stale data, object URLs, dialogs, toasts,
// bounded print polling and web server headers.
// ---------------------------------------------------------------------------
{
  const src = (rel) => fs.readFileSync(rel, 'utf8');
  const need = (ok, message) => { if (!ok) throw new Error(`[FAIL] ${message}`); };
  const poller = src('libs/truck-log/web/data-access/src/lib/polling.ts');
  need(poller.includes('exhaustMap(') && poller.includes('switchMap(') && poller.includes('takeUntilDestroyed(options.destroyRef)'), 'shared poller never overlaps, restarts on manual refresh and stops with the page');
  need(/if \(outcome\.ok\) \{\s*this\.lastUpdated\.set\(new Date\(\)\);/.test(poller) && poller.includes('this.stale.set(true);'), '"Updated" advances only on success; failures mark data stale');
  for (const rel of [
    'libs/truck-log/web/feature/dashboard/src/lib/dashboard.component.ts',
    'libs/truck-log/web/feature/active-trucks/src/lib/active-trucks.component.ts',
    'libs/truck-log/web/feature/rxo-expedite-control-center/src/lib/rxo-expedite/rxo-expedite.store.ts',
    'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.ts',
  ]) need(src(rel).includes('createPoller({'), `${rel} polls through the shared poller`);
  need(!src('libs/truck-log/web/feature/rxo-expedite-control-center/src/lib/rxo-expedite/rxo-expedite.component.ts').includes('setInterval(()=>this.refreshHealthBackground()'), 'Expedite Health tab has no third poll');
  const slot = src('libs/truck-log/web/data-access/src/lib/object-url-slot.ts');
  need(slot.includes('this.release();') && slot.includes('URL.revokeObjectURL(url)'), 'packing-slip PDF object URLs are revoked when replaced or released');
  need(!src('libs/truck-log/web/feature/dashboard/src/lib/dashboard.component.ts').includes('checkoutUrls') && !src('libs/truck-log/web/feature/active-trucks/src/lib/active-trucks.component.ts').includes('checkoutUrls'), 'checkout object URLs no longer accumulate until page destroy');
  const dialog = src('libs/truck-log/web/ui/src/lib/dialog.directive.ts');
  need(dialog.includes("'[attr.aria-modal]': '\"true\"'") && dialog.includes("event.key === 'Escape'") && dialog.includes('previous.focus()'), 'dialogs are modal, close on Escape and return focus');
  const toast = src('libs/truck-log/web/ui/src/lib/toast.service.ts');
  need(toast.includes("error(message: string, title = 'Something went wrong', durationMs = 0)") && toast.includes('if (notice.durationMs > 0) window.setTimeout'), 'error toasts stay until dismissed; others auto-dismiss');
  const tracker = src('libs/truck-log/web/feature/check-in/src/lib/driver-print-tracker.service.ts');
  need(tracker.includes('PRINT_STATUS_POLL_LIMIT_MS') && tracker.includes('this.printerNotResponding = true;') && tracker.includes('Math.min(PRINT_STATUS_POLL_MAX_MS'), 'print-status polling backs off and stops with "Printer not responding"');
  const history = src('libs/truck-log/web/feature/history/src/lib/history.component.ts');
  need(!history.includes('window.prompt(') && !history.includes('sessionStorage.') && history.includes('type="password"'), 'Materials token uses an in-app password dialog and is not stored');
  need(history.includes("this.q = params.get('q') ?? '';") && history.includes('request !== this.openRequest'), 'Records clears a cleared global search and ignores stale record responses');
  const nginx = src('docker/truck-log/nginx.conf');
  need(/location = \/index\.html \{[^}]*Cache-Control "no-cache"/s.test(nginx), 'index.html is never cached stale');
  need(nginx.includes('add_header X-Content-Type-Options "nosniff" always;') && nginx.includes('add_header X-Frame-Options "DENY" always;') && nginx.includes('add_header Referrer-Policy "same-origin" always;'), 'web responses carry security headers');
  need(nginx.includes('try_files $uri =404;') && nginx.includes('location ~* "^/(?!api/).*\\.[A-Za-z0-9]{1,8}$"'), 'missing static files return 404 instead of the app shell (API excluded)');
  need(src('apps/truck-log/src/app/app.component.ts').includes('window.location.reload();') && src('apps/truck-log/src/app/app.component.ts').includes('!this.tvDisplayMode'), 'TV screens reload after the server version changes');
  console.log('[PASS] Web review fixes contract passed.');
}
