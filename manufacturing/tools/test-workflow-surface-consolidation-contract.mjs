import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '');
const entry = read('vendor/dana-ui/package/styles/gear-apps.css');
const cssRel = 'vendor/dana-ui/package/styles/gear-apps/components/workflow-layout.css';
const css = read(cssRel);

if (!entry.includes("@import './gear-apps/components/workflow-layout.css';")) {
  throw new Error('Public Gear Apps style graph is not loading workflow-layout.css.');
}
if (css.split(/\r?\n/).length > 520) throw new Error('workflow-layout.css exceeds the 520-line module ceiling.');
for (const marker of [
  '.gear-workflow-page',
  '.gear-workflow-grid',
  '.gear-workflow-section',
  '.gear-workflow-section-header',
  '.gear-workflow-section-body',
  '.gear-workflow-scan-row',
  '.gear-workflow-form-grid',
  '.gear-workflow-detail-grid',
  '.gear-workflow-result',
  '.gear-workflow-card',
]) {
  if (!css.includes(marker)) throw new Error(`Shared workflow layout missing ${marker}`);
}

const pages = [
  'libs/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.html',
  'libs/frontend/feature-cutter-builder/src/lib/pages/teardown/cutter-teardown.component.html',
  'libs/frontend/feature-cutter-builder/src/lib/pages/lookup/cutter-lookup.component.html',
  'libs/frontend/feature-greenshed/src/lib/pages/setup/greenshed-setup.component.html',
  'libs/frontend/feature-greenshed/src/lib/pages/pull/greenshed-pull.component.html',
  'libs/frontend/feature-greenshed/src/lib/pages/check/greenshed-check.component.html',
];

for (const rel of pages) {
  const html = read(rel);
  for (const marker of ['gear-workflow-page', 'gear-workflow-section', 'gear-btn']) {
    if (!html.includes(marker)) throw new Error(`${rel}: missing shared workflow marker ${marker}`);
  }
  for (const stale of ['rounded-xl', 'bg-slate-', 'grid gap-5', 'gear-panel p-5', 'xl:grid-cols']) {
    if (html.includes(stale)) throw new Error(`${rel}: page-local Tailwind box styling remains (${stale}).`);
  }
  if (/\sstyle\s*=/.test(html)) throw new Error(`${rel}: inline styling is not allowed.`);
}

const build = read(pages[0]);
if (!build.includes('Admin &gt; Cutter Bodies')) throw new Error('Cutter Build lost the Admin Cutter Bodies ownership guidance.');
if (!build.includes('cutter-card')) throw new Error('Cutter Build lost its printable cutter-card marker.');

const teardown = read(pages[1]);
for (const marker of [
  '*ngIf="requiresDullShelf; else noShelfRequired"',
  'No Location Required',
  'Available / Ready to Use',
  'Empty — Available / Ready to Use; no location required',
  'stays EMPTY with 0 blades and no active location assignment',
  'shelfLocation.serial_number',
]) {
  if (!teardown.includes(marker)) throw new Error(`Cutter Teardown lost domain marker ${marker}`);
}

const setup = read(pages[3]);
const pull = read(pages[4]);
const check = read(pages[5]);
for (const [html, label] of [[setup, 'Setup'], [pull, 'Pull'], [check, 'Check']]) {
  if (!html.includes('role="alert"')) throw new Error(`Greenshed ${label} lost accessible error feedback.`);
}
if (!pull.includes('GSR- + Summary for RING or GSP- + Summary for PINION')) {
  throw new Error('Greenshed Pull lost the part-specific shelf instruction.');
}
if (!pull.includes('shelf.serial_number')) throw new Error('Greenshed Pull must display the scannable shelf serial.');

const handoff = read('GEAR-APPS-AI-CHAT-README.md');
for (const marker of [
  'V69.2 COMBINED UI COMPLETION CANDIDATE',
  'full-database search for Inventory Control Center',
  'all 23 frontend tables on `danaTable`',
  'PENDING LIVE WINDOWS CMD VALIDATION',
]) {
  if (!handoff.includes(marker)) throw new Error(`Living handoff missing V69.2 marker: ${marker}`);
}
for (const stale of [
  'CURRENT UNRESOLVED REFERENCES:',
  'NOT YET GREEN / NOT YET TRUSTWORTHY',
  "start from V67.3's unresolved harness references",
]) {
  if (handoff.includes(stale)) throw new Error(`Living handoff still presents superseded V67 state as current: ${stale}`);
}

const designSystem = read('UI_DESIGN_SYSTEM.md');
for (const marker of [
  'Inventory Control Center search standard',
  'Relationship-safe shared table standard',
  'Shared workflow layout standard',
]) {
  if (!designSystem.includes(marker)) throw new Error(`Root UI design-system guide missing ${marker}`);
}

const detailedDesignSystem = read('docs/UI_DESIGN_SYSTEM.md');
for (const marker of [
  'components/workflow-layout.css',
  'V69 shared UI completion sequence',
  'All 23 frontend tables use `danaTable`',
]) {
  if (!detailedDesignSystem.includes(marker)) throw new Error(`Detailed UI design-system guide missing ${marker}`);
}

console.log('[PASS] Workflow surface consolidation contract passed: Cutter Builder and Greenshed workflows use shared sections, fields, actions, results, and preserve domain/accessibility rules.');
