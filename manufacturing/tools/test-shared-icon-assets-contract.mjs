import fs from 'node:fs';
import path from 'node:path';
import { readDanaUiSource } from './lib/dana-ui-source.mjs';

const root = process.cwd();
const requiredIcons = [
  'dashboard','blade','tray','move','container','receive','intake','search','inventory','location','scrap',
  'cutter','build-cutter','teardown','machine','quality-check','pull','shelf','grinding','available','alert','admin','setup',
];

for (const icon of requiredIcons) {
  const rel = `assets/icons/${icon}.svg`;
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error(`Shared icon is missing: ${rel}`);
  const svg = fs.readFileSync(abs, 'utf8');
  if (!svg.includes('<svg') || !svg.includes('viewBox="0 0 24 24"')) {
    throw new Error(`${rel} is not a normalized 24x24 Gear Apps SVG.`);
  }
}

const iconCssRel = 'vendor/dana-ui/package/styles/gear-apps/components/icons.css';
const iconCss = fs.readFileSync(path.join(root, iconCssRel), 'utf8');
if (!iconCss.includes('.gear-glyph')) throw new Error('Shared icon CSS base class is missing.');
for (const icon of requiredIcons) {
  if (!iconCss.includes(`.gear-glyph-${icon}`) || !iconCss.includes(`/assets/icons/${icon}.svg`)) {
    throw new Error(`Shared icon CSS is missing semantic mapping for ${icon}.`);
  }
}

const entry = fs.readFileSync(path.join(root, 'vendor/dana-ui/package/styles/gear-apps.css'), 'utf8');
if (!entry.includes("@import './gear-apps/components/icons.css';")) {
  throw new Error('Gear Apps design-system entry point does not load shared icon CSS.');
}

const navs = [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html',
];
for (const rel of navs) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!text.includes('gear-glyph-dashboard')) throw new Error(`${rel} is missing the semantic dashboard icon.`);
  if (!text.includes('gear-glyph-admin')) throw new Error(`${rel} is missing the semantic admin icon.`);
  if (!text.includes('gear-glyph-search')) throw new Error(`${rel} is missing the semantic search icon.`);
  const rawNavGlyph = /<span class="nav-icon">\s*[⚙↺↔⇩⇣▥▤▦▣⌕⌖⊘✓⌂♙]/u;
  if (rawNavGlyph.test(text)) throw new Error(`${rel} still contains raw Unicode navigation glyphs.`);
}

const dashboardChecks = [
  {
    rel: 'libs/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html',
    kpi: ['gear-glyph-blade','gear-glyph-container','gear-glyph-tray','gear-glyph-move'],
    operation: ['move','container','receive','tray','intake','search','inventory','location'],
  },
  {
    rel: 'libs/frontend/feature-cutter-builder/src/lib/pages/dashboard/cutter-builder-dashboard.component.html',
    kpi: ['gear-glyph-build-cutter','gear-glyph-available','gear-glyph-shelf','gear-glyph-teardown','gear-glyph-grinding','gear-glyph-cutter'],
    operation: ['build-cutter','teardown','search'],
  },
  {
    rel: 'libs/frontend/feature-greenshed/src/lib/pages/dashboard/greenshed-dashboard.component.html',
    kpi: ['gear-glyph-machine','gear-glyph-alert','gear-glyph-shelf','gear-glyph-pull','gear-glyph-available'],
    operation: ['machine','setup','quality-check','pull','search'],
  },
];
for (const { rel, kpi, operation } of dashboardChecks) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const marker of kpi) {
    if (!text.includes(marker)) throw new Error(`${rel} is missing semantic KPI icon ${marker}.`);
  }
  for (const icon of operation) {
    if (!text.includes(`icon="${icon}"`)) throw new Error(`${rel} is missing semantic operation icon input ${icon}.`);
  }
  const rawCardGlyph = /class="(?:kpi-icon|operation-icon)[^"]*">\s*[⚙↺↔⇩⇣▥▤▦▣⌕⌖⊘✓⌂!]/u;
  if (rawCardGlyph.test(text)) throw new Error(`${rel} still contains raw Unicode KPI/operation-card glyphs.`);
}

const operationCard = readDanaUiSource(root, 'lib/components/navigation/dana-operation-card.component.ts');
if (!operationCard.includes(`'gear-glyph gear-glyph-' + resolvedIcon`)) {
  throw new Error('Shared Dana operation card does not render the centralized semantic SVG glyph class.');
}
if (!operationCard.includes(`' dana-glyph dana-glyph-' + resolvedIcon`)) {
  throw new Error('Shared Dana operation card does not expose the Dana semantic glyph alias.');
}
for (const leaked of ['Internal Movement','Blade Intake','Build Cutter','Cutter Pull','Running Machines','Quality Check']) {
  if (operationCard.includes(leaked)) throw new Error(`Shared Dana operation card leaked Gear workflow knowledge: ${leaked}.`);
}
if (!operationCard.includes(`@Input() icon = 'search'`) || !operationCard.includes('return this.icon?.trim()')) {
  throw new Error('Shared Dana operation card must render an explicit semantic icon input with a generic fallback.');
}
if (/[⚙↺↔⇩⇣▥▤▦▣⌕⌖⊘✓⌂•]/u.test(operationCard)) {
  throw new Error('Shared Dana operation card still contains Unicode fallback glyphs instead of semantic SVG icons.');
}

for (const app of ['blade-tracking', 'cutter-builder', 'greenshed']) {
  const project = JSON.parse(fs.readFileSync(path.join(root, `apps/${app}/project.json`), 'utf8'));
  const assets = project.targets?.build?.options?.assets ?? [];
  if (!assets.some((entry) => typeof entry === 'object' && entry.input === 'assets' && entry.output === 'assets')) {
    throw new Error(`${app} does not publish the shared semantic icon assets.`);
  }
}

if (!fs.existsSync(path.join(root, 'assets/icons/README.md'))) {
  throw new Error('Shared icon asset instructions are missing.');
}

console.log(`[PASS] Shared semantic icon contract passed with ${requiredIcons.length} centralized workflow icons across all Gear Apps frontends.`);
