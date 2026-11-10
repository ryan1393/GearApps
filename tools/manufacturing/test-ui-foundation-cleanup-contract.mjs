import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { listGearAppsStyleModules, readGearAppsStyles } from './lib/read-gear-apps-styles.mjs';
import { readDanaUiSource } from './lib/dana-ui-source.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(contractPath(root, rel), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').trim();

const entry = read('libs/shared/dana-ui/src/styles/gear-apps.css');
const tokens = read('libs/shared/dana-ui/src/styles/gear-apps/foundation/tokens.css');
const designTokens = read('libs/shared/dana-ui/src/styles/gear-apps/features/design-tokens.css');
const cleanup = read('libs/shared/dana-ui/src/styles/gear-apps/features/ui-cleanup.css');
const data = read('libs/shared/dana-ui/src/styles/gear-apps/components/data-display.css');
const dashboard = read('libs/shared/dana-ui/src/styles/gear-apps/features/dashboard.css');
const typography = read('libs/shared/dana-ui/src/styles/gear-apps/features/typography.css');
const primitives = read('libs/shared/dana-ui/src/styles/gear-apps/components/primitives.css');
const admin = read('libs/shared/dana-ui/src/styles/gear-apps/features/admin-core.css');
const directive = readDanaUiSource(root, 'lib/components/data/dana-table.directive.ts');
const icons = read('libs/shared/dana-ui/src/styles/gear-apps/components/icons.css');
const navs = [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html',
].map(read);

if (entry.includes('features/design-tokens.css')) {
  throw new Error('Retired design-tokens.css is still imported by the public entry point.');
}
if (stripComments(designTokens) || stripComments(cleanup)) {
  throw new Error('Retired design-token/UI-cleanup source notes still contain active CSS declarations.');
}

for (const marker of [
  '--gear-font-sans:', '--gear-font-xs: 11px;', '--gear-weight-semibold:',
  '--gear-line-normal:', '--gear-space-5:', '--gear-table-header-pad-y:',
  '--gear-table-cell-pad-x:', '--gear-panel-bg:', '--gear-control-height:',
  '--gear-shadow-popover:',
]) {
  if (!tokens.includes(marker)) throw new Error(`Canonical tokens.css is missing ${marker}`);
}

const sharedCss = readGearAppsStyles(root);
for (const retiredFamily of ['--gear-font-size-', '--gear-font-weight-', '--gear-line-height-']) {
  if (sharedCss.includes(retiredFamily)) throw new Error(`Retired duplicate token family remains active: ${retiredFamily}`);
}
if (!typography.includes('var(--gear-weight-semibold)') || !typography.includes('var(--gear-line-normal)')) {
  throw new Error('Typography module is not using canonical weight/line-height tokens.');
}

for (const marker of ['.dana-table-sortable','.dana-table-filter-popover','var(--gear-table-header-pad-y)','var(--gear-table-cell-pad-y)']) {
  if (!data.includes(marker)) throw new Error(`data-display.css is missing shared table ownership marker ${marker}`);
}
for (const stale of ['DANA TABLE FILTER SORT V53','TABLE RHYTHM V65.6','.dana-table-filter-popover']) {
  if (dashboard.includes(stale)) throw new Error(`dashboard.css still owns retired table override debt: ${stale}`);
}
if (admin.includes('V35.3 RETIRED ADMIN-STANDARD MIGRATION')) throw new Error('admin-core.css still carries the retired V35.3 override marker.');
if (primitives.includes('html body html body')) throw new Error('primitives.css still contains malformed repeated html/body selector text.');
for (const stale of ['padding: 9px 11px','padding:9px 11px','padding: 10px 11px','padding:10px 11px']) {
  if (data.includes(stale)) throw new Error(`Hard-coded legacy table padding remains: ${stale}`);
}

for (const nav of navs) {
  if (nav.includes('↵')) throw new Error('Topbar search still contains the Unicode enter glyph.');
  if (!nav.includes('<span class="gear-glyph gear-glyph-search" aria-hidden="true"></span></button>')) {
    throw new Error('Topbar search submit button is not using the shared semantic search glyph.');
  }
}
for (const glyph of ['↕','↑','↓','×']) {
  if (directive.includes(glyph)) throw new Error(`Dana table directive still contains Unicode control glyph ${glyph}.`);
}
for (const marker of ['gear-glyph-sort','gear-glyph-sort-asc','gear-glyph-sort-desc','gear-glyph-close']) {
  if (!directive.includes(marker) || !icons.includes(`.${marker}`)) throw new Error(`Shared table semantic icon mapping is incomplete: ${marker}`);
}

const modules = listGearAppsStyleModules(root);
for (const rel of modules) {
  const lines = read(rel).split(/\r?\n/).length;
  if (lines > 520) throw new Error(`${rel} exceeds the 520-line shared style ceiling (${lines}).`);
}
if (data.split(/\r?\n/).length > 520) throw new Error('data-display.css exceeded the module ceiling.');
if (dashboard.split(/\r?\n/).length >= 480) throw new Error('dashboard.css did not shed enough table override debt.');

console.log('[PASS] UI foundation cleanup contract passed: one canonical token source, retired dead CSS, shared table ownership, and semantic search/sort/close icons.');
