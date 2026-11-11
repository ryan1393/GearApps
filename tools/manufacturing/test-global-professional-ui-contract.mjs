import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { readGearAppsStyles } from './lib/read-gear-apps-styles.mjs';

const css=readGearAppsStyles();

const navs=[
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html',
];

const dashboards=[
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html',
  'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/dashboard/cutter-builder-dashboard.component.html',
  'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/dashboard/greenshed-dashboard.component.html',
];

for(const marker of [
  'GEAR APPS DESIGN SYSTEM TOKENS',
  '--gear-sidebar-width: 272px',
  '.brand-copy',
  '.nav-current',
  '.side-link.active-sub::before',
  '.dashboard-heading',
  '.kpi-grid',
  '.operation-grid',
  '.dashboard-table',
  '.inventory-overview-kpis',
  '.gear-admin-tabs',
]){
  if(!css.includes(marker)){
    throw new Error(`Global professional UI source missing ${marker}`);
  }
}

for(const file of navs){
  const html=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  for(const marker of [
    '<small>MESHFORGE</small>',
    'class="brand-copy"',
    'class="nav-current">ACTIVE</span>',
    '<div class="nav-heading">SHARED APPS</div>',
    '<div class="nav-heading">ADMINISTRATION</div>',
  ]){
    if(!html.includes(marker)){
      throw new Error(`${file} missing professional shared nav marker ${marker}`);
    }
  }
}

const dashboardLabels = new Map([
  [navs[0], 'Blade Dashboard'],
  [navs[1], 'Cutter Dashboard'],
  [navs[2], 'Greenshed Dashboard'],
]);
for (const [file, label] of dashboardLabels) {
  const html = fs.readFileSync(contractPath(process.cwd(), file), 'utf8');
  if (!html.includes(`<span>${label}</span>`)) {
    throw new Error(`${file} must expose one combined ${label} primary navigation row.`);
  }
  if (html.includes('<div class="nav-heading">WORKSPACE</div>')) {
    throw new Error(`${file} must not reintroduce a separate WORKSPACE heading above the app dashboard.`);
  }
}

const bladeNav=fs.readFileSync(contractPath(process.cwd(), navs[0]),'utf8');
for(const marker of [
  '<div class="nav-heading">INVENTORY</div>',
  'routerLink="/blades/all-inventory"',
  '<span>Inventory Control Center</span>',
]){
  if(!bladeNav.includes(marker)){
    throw new Error(`Blade sidebar missing ${marker}`);
  }
}

for(const file of dashboards){
  const html=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  if(/<style[\s>]/i.test(html)){
    throw new Error(
      `${file} still contains page-local dashboard CSS; dashboard styling must come from the shared global source.`,
    );
  }
}

console.log(
  '[PASS] Global professional UI contract passed: all apps share the canonical Gear Apps shell/dashboard design and Blade sidebar exposes the Inventory Control Center.',
);
