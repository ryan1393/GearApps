import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');

const navs={
  blade:read('apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html'),
  cutter:read('apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html'),
  greenshed:read('apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html'),
};

for(const [name,html] of Object.entries(navs)){
  for(const marker of ['gear-sidebar','brand-row','side-nav','side-link primary','sidebar-footer','gear-topbar','global-search','topbar-user','signout-button','Shared manufacturing workspace','v{{ appVersion }}']){
    if(!html.includes(marker)) throw new Error(`${name} navigation is missing shared Gear Apps shell marker: ${marker}`);
  }
  if(!html.includes('Dashboard')) throw new Error(`${name} navigation must expose a combined app dashboard link.`);
  if(!html.includes('global-search') || !html.includes('aria-label=')) throw new Error(`${name} topbar must expose an accessible app-specific search treatment.`);
}

const expectedDashboardLabels = {
  blade: 'Blade Dashboard',
  cutter: 'Cutter Dashboard',
  greenshed: 'Greenshed Dashboard',
};
for (const [name, label] of Object.entries(expectedDashboardLabels)) {
  const html = navs[name];
  if (!html.includes(`<span>${label}</span>`)) throw new Error(`${name} navigation is missing combined dashboard label: ${label}`);
  if (html.includes('<div class="nav-heading">WORKSPACE</div>')) throw new Error(`${name} navigation still has redundant WORKSPACE/app dashboard hierarchy.`);
}

const dashboards={
  blade:read('libs/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html'),
  cutter:read('libs/frontend/feature-cutter-builder/src/lib/pages/dashboard/cutter-builder-dashboard.component.html'),
  greenshed:read('libs/frontend/feature-greenshed/src/lib/pages/dashboard/greenshed-dashboard.component.html'),
};

for(const [name,html] of Object.entries(dashboards)){
  for(const marker of ['gear-page','dashboard-page','dashboard-heading','kpi-grid','kpi-card','gear-panel','operations-panel','operation-grid','operation-card']){
    if(!html.includes(marker)) throw new Error(`${name} dashboard is missing shared Blade Tracking design marker: ${marker}`);
  }
}

for(const name of ['cutter','greenshed']){
  if(!dashboards[name].includes('Welcome back. Here’s what’s happening')){
    throw new Error(`${name} dashboard heading does not follow Blade Tracking dashboard language/layout.`);
  }
}

console.log('[PASS] Blade Tracking, Cutter Builder, and Greenshed use the shared Gear Apps shell and dashboard design language.');
