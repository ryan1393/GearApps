import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { danaUiBundleText, danaUiPublicApiText, readDanaUiSource } from './lib/dana-ui-source.mjs';
const root = path.resolve(process.argv[2] || '.');
const read = (r) => fs.readFileSync(contractPath(root, r), 'utf8').replace(/\r\n/g, '\n');
const must = (c,m) => { if(!c) throw new Error(m); };
const count = (s,n) => s.split(n).length - 1;
const attrCount = (s,n) => (s.match(new RegExp('\\b' + n + '(?:\\s|=|>)','g')) || []).length;
const headerFiles = [
  "libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/intake/intake.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/internal-movement/internal-movement.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/load-container/load-container.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/receive-container/receive-container.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/scrap-blades/scrap-blades.component.html",
  "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html",
  "libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.html",
  "libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/dashboard/cutter-builder-dashboard.component.html",
  "libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/lookup/cutter-lookup.component.html",
  "libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/teardown/cutter-teardown.component.html",
  "libs/manufacturing/frontend/feature-greenshed/src/lib/pages/check/greenshed-check.component.html",
  "libs/manufacturing/frontend/feature-greenshed/src/lib/pages/dashboard/greenshed-dashboard.component.html",
  "libs/manufacturing/frontend/feature-greenshed/src/lib/pages/lookup/greenshed-lookup.component.html",
  "libs/manufacturing/frontend/feature-greenshed/src/lib/pages/pull/greenshed-pull.component.html",
  "libs/manufacturing/frontend/feature-greenshed/src/lib/pages/setup/greenshed-setup.component.html"
];
const opFiles = new Map([
  [
    "libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html",
    8
  ],
  [
    "libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/dashboard/cutter-builder-dashboard.component.html",
    3
  ],
  [
    "libs/manufacturing/frontend/feature-greenshed/src/lib/pages/dashboard/greenshed-dashboard.component.html",
    5
  ]
]);
const pageHeader = danaUiBundleText();
const opCard = readDanaUiSource(root, 'lib/components/navigation/dana-operation-card.component.ts');
const opGrid = readDanaUiSource(root, 'lib/components/navigation/dana-operation-grid.directive.ts');
const hostClasses = source => (/\bhost\s*:\s*\{[^}]*\bclass\s*:\s*(['"])(.*?)\1/s.exec(source)?.[2] ?? '').split(/\s+/);
const index = danaUiPublicApiText();
must(pageHeader.includes("selector: '[danaPageHeader]'") && pageHeader.includes("class: 'dana-page-header gear-page-header'"), 'DanaPageHeaderComponent must own canonical dana-page-header and preserve gear-page-header compatibility alias.');
must(pageHeader.includes('dana-eyebrow') && pageHeader.includes('dana-page-title') && pageHeader.includes('dana-page-description'), 'DanaPageHeaderComponent is missing canonical Dana title vocabulary.');
must(pageHeader.includes('gear-eyebrow') && pageHeader.includes('gear-page-title') && pageHeader.includes('gear-page-description'), 'DanaPageHeaderComponent must preserve legacy Gear title aliases during migration.');
must(opCard.includes("selector: 'a[danaOperationCard]'") && hostClasses(opCard).includes('operation-card') && hostClasses(opCard).includes('dana-operation-card'), 'DanaOperationCardComponent does not own canonical operation-card host class.');
must(opCard.includes('operation-icon') && opCard.includes('operation-copy') && opCard.includes('operation-arrow'), 'DanaOperationCardComponent is missing canonical operation-card internals.');
must(opGrid.includes("selector: '[danaOperationGrid]'") && hostClasses(opGrid).includes('operation-grid') && hostClasses(opGrid).includes('dana-operation-grid'), 'DanaOperationGridDirective does not own operation-grid semantics.');
for (const name of ['DanaPageHeaderComponent','DanaOperationCardComponent','DanaOperationGridDirective']) must(index.includes(name), name + ' is not exported from shared UI.');
for (const rel of headerFiles) { const html = read(rel); const ts = read(rel.replace(/\.html$/, '.ts')); must(attrCount(html,'danaPageHeader')===1, rel + ': expected one Dana page header.'); must(/class="[^"]*\bgear-page-header\b/.test(html), rel + ': gear-page-header contract marker is missing.'); must(ts.includes('DanaPageHeaderComponent'), rel + ': TS missing DanaPageHeaderComponent.'); }
for (const [rel, expected] of opFiles) { const html = read(rel); const ts = read(rel.replace(/\.html$/, '.ts')); const cards = count(html,'danaOperationCard'); must(cards>=expected, rel + ': operation cards were removed (expected at least ' + expected + ').'); must(count(html,'class="operation-card"')===cards, rel + ': every operation card must carry the operation-card contract marker.'); must(count(html,'danaOperationGrid')===1, rel + ': expected one Dana operation grid.'); must(ts.includes('DanaOperationCardComponent') && ts.includes('DanaOperationGridDirective'), rel + ': TS missing Dana operation primitives.'); }
console.log('[PASS] Dana component consolidation contract: 20 page headers and 16 dashboard operation cards now have one shared Angular implementation.');
