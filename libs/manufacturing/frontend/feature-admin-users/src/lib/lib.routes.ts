import { inject } from '@angular/core';
import { CanActivateFn, Route, Router } from '@angular/router';
import { CollectorTokensPageComponent, CycleTestsPageComponent, FanucVariablesPageComponent, MacrosPageComponent, ScannersPageComponent } from '@meshforge/client/feature-config';

import { CoaterRpaSetupComponent } from './coater-rpa/coater-rpa-setup.component';
import { DsfMachineMappingsComponent } from './dsf-machine-mappings/dsf-machine-mappings.component';
import { FrontendFeatureAdminUsersComponent } from './frontend-feature-admin-users/frontend-feature-admin-users.component';
import { LabelPrintersComponent } from './label-printers/label-printers.component';
import { LappingGearsetsComponent } from './lapping/lapping-gearsets.component';
import { ServerSettingsComponent } from './server-settings/server-settings.component';
import { DEFAULT_ADMIN_TAB, isAdminTab } from './shared/admin-tabs';
import { AdminAccessTabComponent, AdminLappingMachinesTabComponent, AdminLaunchTabComponent } from './tabs/admin-tab-hosts.component';
import { AdminContainersTabComponent } from './tabs/containers/admin-containers-tab.component';
import { AdminCutterBodiesTabComponent } from './tabs/cutter-bodies/admin-cutter-bodies-tab.component';
import { AdminLocationsTabComponent } from './tabs/locations/admin-locations-tab.component';
import { AdminMachinesTabComponent } from './tabs/machines/admin-machines-tab.component';
import { AdminModelsTabComponent } from './tabs/models/admin-models-tab.component';
import { AdminPartSummariesTabComponent } from './tabs/part-summaries/admin-part-summaries-tab.component';
import { AdminPartsTabComponent } from './tabs/parts/admin-parts-tab.component';
import { AdminRollMastersTabComponent } from './tabs/roll-masters/admin-roll-masters-tab.component';
import { AdminTraysTabComponent } from './tabs/trays/admin-trays-tab.component';
import { AdminUsersTabComponent } from './tabs/users/admin-users-tab.component';

/**
 * /admin opens Users; links from before the tabs were routes (/admin?tab=gearsets, used by the old
 * Lapping pages and bookmarks) open that tab at /admin/gearsets. Other query parameters are kept.
 */
export const adminTabRedirect: CanActivateFn = (route, state) => {
  const { tab, ...rest } = route.queryParams;
  const base = state.url.split(/[?#]/)[0].replace(/\/+$/, '');
  return inject(Router).createUrlTree([base || '/', isAdminTab(tab) ? tab : DEFAULT_ADMIN_TAB], {
    queryParams: rest,
    fragment: route.fragment ?? undefined,
  });
};

export const frontendFeatureAdminUsersRoutes: Route[] = [
  {
    path: '',
    component: FrontendFeatureAdminUsersComponent,
    children: [
      { path: '', pathMatch: 'full', canActivate: [adminTabRedirect], children: [] },
      { path: 'users', component: AdminUsersTabComponent },
      { path: 'part-summaries', component: AdminPartSummariesTabComponent },
      { path: 'parts', component: AdminPartsTabComponent },
      { path: 'gearsets', component: LappingGearsetsComponent },
      { path: 'roll-masters', component: AdminRollMastersTabComponent },
      { path: 'models', component: AdminModelsTabComponent },
      { path: 'cycle-tests', component: CycleTestsPageComponent },
      { path: 'machines', component: AdminMachinesTabComponent },
      { path: 'lapping-machines', component: AdminLappingMachinesTabComponent },
      { path: 'scanners', component: ScannersPageComponent },
      { path: 'macros', component: MacrosPageComponent },
      { path: 'fanuc-variables', component: FanucVariablesPageComponent },
      { path: 'collector-tokens', component: CollectorTokensPageComponent },
      { path: 'trays', component: AdminTraysTabComponent },
      { path: 'containers', component: AdminContainersTabComponent },
      { path: 'locations', component: AdminLocationsTabComponent },
      { path: 'cutter-bodies', component: AdminCutterBodiesTabComponent },
      { path: 'access', component: AdminAccessTabComponent },
      { path: 'launch', component: AdminLaunchTabComponent },
      { path: 'dsf-mappings', component: DsfMachineMappingsComponent },
      { path: 'label-printers', component: LabelPrintersComponent },
      { path: 'coater-rpa', component: CoaterRpaSetupComponent },
      { path: 'server-settings', component: ServerSettingsComponent },
      { path: '**', redirectTo: DEFAULT_ADMIN_TAB },
    ],
  },
];
