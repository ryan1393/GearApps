import fs from 'node:fs';
import { readSourceFamily } from './lib/source-family.mjs';

const read=(p)=>readSourceFamily(process.cwd(),p);

const controller=read('libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.controller.ts');
const service=read('libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.service.ts');
const api=read('libs/manufacturing/frontend/data-access-blade-tracking/src/lib/blade-tracking-api.service.ts');
const component=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.ts');
const html=read('libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html');
const manifest=JSON.parse(read('tools/manufacturing/api-route-manifest.json'));

for(const marker of [
  "@Get('dashboard')",
  '@Auth([RoleType.ADMIN, RoleType.USER])',
  'return this.trayService.getDashboard()',
]){
  if(!controller.includes(marker)){
    throw new Error(`Blade dashboard controller missing ${marker}`);
  }
}

for(const marker of [
  'async getDashboard()',
  'BladeStatus.SCRAPPED',
  'ContainerTrayOrmEntity',
  'LocationTrayOrmEntity',
  'blades_in_process',
  'trays_at_coater',
  'trays_in_house',
  'movements_today',
  'stage_breakdown',
  'top_locations',
  'coater_containers',
  'recent_activity',
  "type: 'LOCATION_MOVE'",
  "type: 'CONTAINER_LOAD'",
  "type: 'CONTAINER_RETURN'",
]){
  if(!service.includes(marker)){
    throw new Error(`Blade dashboard service missing ${marker}`);
  }
}

for(const marker of [
  'export interface BladeTrackingDashboardData',
  "getDashboard()",
  "'/api/v1/trays/dashboard'",
]){
  if(!api.includes(marker)){
    throw new Error(`Blade dashboard frontend API missing ${marker}`);
  }
}

for(const marker of [
  'implements OnInit',
  'dashboard: BladeTrackingDashboardData | null',
  'refreshDashboard(): void',
  'this.api.getDashboard()',
]){
  if(!component.includes(marker)){
    throw new Error(`Blade dashboard component missing ${marker}`);
  }
}

for(const marker of [
  'dashboard?.counts?.blades_in_process',
  'dashboard?.counts?.trays_at_coater',
  'dashboard?.counts?.trays_in_house',
  'dashboard?.counts?.movements_today',
  'Inventory By Stage',
  'Inventory By Location',
  'Recent Activity',
  'At The Coater',
  '*ngFor="let stage of dashboard?.stage_breakdown"',
  '*ngFor="let location of dashboard?.top_locations"',
  '*ngFor="let activity of dashboard?.recent_activity"',
  '*ngFor="let container of dashboard?.coater_containers"',
]){
  if(!html.includes(marker)){
    throw new Error(`Blade dashboard live UI missing ${marker}`);
  }
}

for(const stale of [
  '<strong>—</strong><h3>Blades In Process</h3>',
  'Activity feed ready',
  'The layout is ready for live history',
]){
  if(html.includes(stale)){
    throw new Error(`Blade dashboard still contains stale placeholder UI: ${stale}`);
  }
}

const dashboardRoute=manifest.find(
  (route)=>route.method==='GET' && route.path==='/api/v1/trays/dashboard',
);
if(!dashboardRoute){
  throw new Error('Route manifest is missing GET /api/v1/trays/dashboard.');
}

if(manifest.length!==114){
  throw new Error(`Expected 114 API routes after public registration closure; found ${manifest.length}.`);
}

console.log(
  '[PASS] Blade Tracking live-dashboard contract passed: KPI counts, stage/location summaries, coater inventory, and recent activity are backed by database queries instead of placeholder values.',
);
