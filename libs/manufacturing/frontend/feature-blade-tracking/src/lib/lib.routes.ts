import { WorkflowCancellationComponent } from '@meshforge/manufacturing/frontend/util-common';
import { Route } from '@angular/router';
import { departmentEditorGuard } from '@meshforge/manufacturing/frontend/data-access-common';
import { BLADE_OPERATIONS } from './pages/operations-station/operations-station.operations';
import { BladeTrackingShellComponent } from './shell/blade-tracking-shell.component';

export const frontendFeatureBladeTrackingRoutes: Route[] = [
  {
    path: '',
    component: BladeTrackingShellComponent,
    children: [
      { path: 'cancel-last', canActivate: [departmentEditorGuard('BLADE_TRACKING')], component: WorkflowCancellationComponent, data: { cancellationApp: 'blade-tracking' } },
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent) },
      { path: 'operations', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/operations-station/operations-station.component').then((m) => m.OperationsStationComponent) },
      // The separate operation pages are now tabs of the operations station; keep their old URLs working.
      ...BLADE_OPERATIONS.map(({ key }): Route => ({ path: key, pathMatch: 'full', redirectTo: `/blades/operations?op=${key}` })),
      { path: 'tray-contents', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/tray-contents/tray-contents.component').then((m) => m.TrayContentsComponent) },
      { path: 'body-shelves', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/body-shelves/body-shelves.component').then((m) => m.BodyShelvesComponent) },
      { path: 'inventory', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/inventory-lookup/inventory-lookup.component').then((m) => m.InventoryLookupComponent) },
      { path: 'all-inventory', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/inventory-overview/inventory-overview.component').then((m) => m.InventoryOverviewComponent) },
      { path: 'locations', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/locations/blade-locations.component').then((m) => m.BladeLocationsComponent) },
      { path: 'scrap-blades', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/scrap-blades/scrap-blades.component').then((m) => m.ScrapBladesComponent) },
    ],
  },
];
