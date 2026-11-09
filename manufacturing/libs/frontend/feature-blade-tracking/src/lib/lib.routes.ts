import { WorkflowCancellationComponent } from '@libs/frontend/util-common';
import { Route } from '@angular/router';
import { departmentEditorGuard } from '@libs/frontend/data-access-common';
import { BladeTrackingShellComponent } from './shell/blade-tracking-shell.component';

export const frontendFeatureBladeTrackingRoutes: Route[] = [
  {
    path: '',
    component: BladeTrackingShellComponent,
    children: [
      { path: 'cancel-last', canActivate: [departmentEditorGuard('BLADE_TRACKING')], component: WorkflowCancellationComponent, data: { cancellationApp: 'blade-tracking' } },
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent) },
      { path: 'internal-movement', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/internal-movement/internal-movement.component').then((m) => m.InternalMovementComponent) },
      { path: 'coater-shipments', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/coater-shipments/coater-shipments.component').then(m => m.CoaterShipmentsComponent) },
      { path: 'load-container', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/load-container/load-container.component').then((m) => m.LoadContainerComponent) },
      { path: 'receive-container', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/receive-container/receive-container.component').then((m) => m.ReceiveContainerComponent) },
      { path: 'tray-contents', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/tray-contents/tray-contents.component').then((m) => m.TrayContentsComponent) },
      { path: 'intake', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/intake/intake.component').then((m) => m.IntakeComponent) },
      { path: 'body-shelves', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/body-shelves/body-shelves.component').then((m) => m.BodyShelvesComponent) },
      { path: 'grinding', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/grinding/grinding.component').then((m) => m.GrindingComponent) },
      { path: 'inventory', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/inventory-lookup/inventory-lookup.component').then((m) => m.InventoryLookupComponent) },
      { path: 'all-inventory', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/inventory-overview/inventory-overview.component').then((m) => m.InventoryOverviewComponent) },
      { path: 'locations', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/locations/blade-locations.component').then((m) => m.BladeLocationsComponent) },
      { path: 'scrap-blades', canActivate: [departmentEditorGuard('BLADE_TRACKING')], loadComponent: () => import('./pages/scrap-blades/scrap-blades.component').then((m) => m.ScrapBladesComponent) },
    ],
  },
];
