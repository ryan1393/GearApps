import { WorkflowCancellationComponent } from '@gearapps/manufacturing/frontend/util-common';
import { Route } from '@angular/router';
import { departmentEditorGuard } from '@gearapps/manufacturing/frontend/data-access-common';
import { CutterBuilderDashboardComponent } from './pages/dashboard/cutter-builder-dashboard.component';
import { CutterBuildComponent } from './pages/build/cutter-build.component';
import { CutterTeardownComponent } from './pages/teardown/cutter-teardown.component';
import { CutterLookupComponent } from './pages/lookup/cutter-lookup.component';

export const frontendFeatureCutterBuilderRoutes: Route[] = [
  { path: 'cancel-last', canActivate: [departmentEditorGuard('CUTTER_BUILDER')], component: WorkflowCancellationComponent, data: { cancellationApp: 'cutter-builder' } },
  { path: '', pathMatch: 'full', component: CutterBuilderDashboardComponent },
  { path: 'build', canActivate: [departmentEditorGuard('CUTTER_BUILDER')], component: CutterBuildComponent },
  { path: 'teardown', canActivate: [departmentEditorGuard('CUTTER_BUILDER')], component: CutterTeardownComponent },
  { path: 'lookup', canActivate: [departmentEditorGuard('CUTTER_BUILDER')], component: CutterLookupComponent },
];
