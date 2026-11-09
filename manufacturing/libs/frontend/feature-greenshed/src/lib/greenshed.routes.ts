import { WorkflowCancellationComponent } from '@libs/frontend/util-common';
import { Route } from '@angular/router';
import { departmentEditorGuard } from '@libs/frontend/data-access-common';
import { GreenshedDashboardComponent } from './pages/dashboard/greenshed-dashboard.component';
import { GreenshedSetupComponent } from './pages/setup/greenshed-setup.component';
import { GreenshedCheckComponent } from './pages/check/greenshed-check.component';
import { GreenshedPullComponent } from './pages/pull/greenshed-pull.component';
import { GreenshedLookupComponent } from './pages/lookup/greenshed-lookup.component';
import { GreenshedMachinesComponent } from './pages/machines/greenshed-machines.component';

export const frontendFeatureGreenshedRoutes: Route[] = [
  { path: 'cancel-last', canActivate: [departmentEditorGuard('GREENSHED')], component: WorkflowCancellationComponent, data: { cancellationApp: 'greenshed' } },
  { path:'', pathMatch:'full', component:GreenshedDashboardComponent },
  { path:'machines', canActivate:[departmentEditorGuard('GREENSHED')], component:GreenshedMachinesComponent },
  { path:'setup', canActivate:[departmentEditorGuard('GREENSHED')], component:GreenshedSetupComponent },
  { path:'check', canActivate:[departmentEditorGuard('GREENSHED')], component:GreenshedCheckComponent },
  { path:'pull', canActivate:[departmentEditorGuard('GREENSHED')], component:GreenshedPullComponent },
  { path:'lookup', canActivate:[departmentEditorGuard('GREENSHED')], component:GreenshedLookupComponent }
];
