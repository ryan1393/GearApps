import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readDanaUiSource } from './lib/dana-ui-source.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(contractPath(root, rel), 'utf8').replace(/^\uFEFF/, '');
const frontendRoot = contractPath(root, 'libs/manufacturing/frontend');
const htmlFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(contractPath(process.cwd(), dir), { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}
walk(frontendRoot);

const tables = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(contractPath(process.cwd(), file), 'utf8').replace(/^\uFEFF/, '');
  for (const match of html.matchAll(/<table\b[^>]*>/gi)) {
    tables.push({ file, tag: match[0] });
  }
}

if (tables.length < 23) {
  throw new Error(`Frontend table inventory shrank below the maintained 23 tables; found ${tables.length}.`);
}

// Known exceptions, added after the danaTable migration. Coater Shipments prints its
// manifest tables and the dashboard tray-availability table has its own layout; move
// them to danaTable only after checking screen and print output. Do not add new ones.
const PENDING_DANA_TABLE = new Map([
  ['libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/coater-shipments/coater-shipments.component.html', 3],
  ['libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html', 1],
]);
const pendingSeen = new Map();
const notShared = tables.filter(({ file, tag }) => {
  if (/\bdanaTable\b/.test(tag)) return false;
  const rel = path.relative(root, file).split(path.sep).join('/');
  const used = (pendingSeen.get(rel) ?? 0) + 1;
  pendingSeen.set(rel, used);
  return used > (PENDING_DANA_TABLE.get(rel) ?? 0);
});
if (notShared.length) {
  throw new Error(`Tables still outside danaTable: ${notShared.map((row) => path.relative(root, row.file)).join(', ')}`);
}

const tableFiles = [...new Set(tables.filter(({ tag }) => /\bdanaTable\b/.test(tag)).map(({ file }) => file))];
for (const htmlFile of tableFiles) {
  const relative = path.relative(root, htmlFile).replaceAll('\\', '/');
  const tsFile = htmlFile.replace(/\.html$/, '.ts');
  if (!fs.existsSync(contractPath(process.cwd(), tsFile))) throw new Error(`${relative}: matching standalone component TS file is missing.`);
  const ts = fs.readFileSync(contractPath(process.cwd(), tsFile), 'utf8');
  if (!ts.includes('DanaTableDirective')) throw new Error(`${relative}: component does not import DanaTableDirective.`);
  if (!ts.includes('DanaTableShellDirective')) throw new Error(`${relative}: component does not import DanaTableShellDirective.`);
}

const directive = readDanaUiSource(root, 'lib/components/data/dana-table.directive.ts');
for (const marker of [
  'interface DanaTableRowGroup',
  'private danaTableBuildRowGroups',
  "row.hasAttribute('data-dana-table-detail')",
  "row.getAttribute('data-dana-table-group')",
  'for (const row of group.rows)',
  'danaTableSyncNoMatchState',
]) {
  if (!directive.includes(marker)) throw new Error(`Dana table relationship-safe grouping missing ${marker}`);
}

const relationshipPages = [
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/scrap-blades/scrap-blades.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html',
];
for (const rel of relationshipPages) {
  const html = read(rel);
  if (!html.includes('data-dana-table-detail="true"')) throw new Error(`${rel}: expanded detail rows are not marked for grouped sorting.`);
  if (!html.includes('data-dana-table-group')) throw new Error(`${rel}: parent/detail group identity marker is missing.`);
}

const formerlyUnsharedPages = [
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/grinding/grinding.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/scrap-blades/scrap-blades.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html',
  'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/lookup/cutter-lookup.component.html',
  'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/lookup/greenshed-lookup.component.html',
  'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/machines/greenshed-machines.component.html',
];
for (const rel of formerlyUnsharedPages) {
  const html = read(rel);
  if (!/<table\s+danaTable\b/.test(html)) throw new Error(`${rel}: shared table migration is missing.`);
  if (!html.includes('danaTableShell')) throw new Error(`${rel}: shared table shell is missing.`);
}

for (const rel of [
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/scrap-blades/scrap-blades.component.html',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html',
  'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/lookup/cutter-lookup.component.html',
  'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/lookup/greenshed-lookup.component.html',
]) {
  if (!read(rel).includes('data-dana-table-static')) throw new Error(`${rel}: action column must remain non-sortable.`);
}

console.log(`[PASS] Shared table migration contract passed: ${tables.length - [...PENDING_DANA_TABLE.values()].reduce((a, b) => a + b, 0)} of ${tables.length} tables use danaTable (the rest are listed pending exceptions) and expanded parent/detail rows remain grouped during sorting/filtering.`);
