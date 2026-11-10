import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceRoot } from './lib/contract-paths.mjs';

const policy=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/shared/util-constants/src/lib/app-access.constants.ts'),'utf8');
const roleGuard=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/util-common/src/lib/guards/role.guard.ts'),'utf8');
const decorator=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/util-common/src/lib/decorators/department-app-edit.decorator.ts'),'utf8');
const jwtStrategy=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-auth/src/lib/strategies/jwt-access.strategy.ts'),'utf8');
const authService=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-auth/src/lib/server-feat-auth.service.ts'),'utf8');
const requestUser=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/shared/util-types/src/lib/interfaces/request-user.interface.ts'),'utf8');
const sharedPrincipal=fs.readFileSync(contractPath(process.cwd(), path.join(workspaceRoot,'libs/shared/domain/src/lib/auth/auth.ts')),'utf8');
if(!requestUser.includes('extends AuthenticatedUser')) throw new Error('Request principal must extend the shared domain contract');
const jwtPayload=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/shared/util-types/src/lib/interfaces/jwt-payload.interface.ts'),'utf8');
const frontendGuard=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/data-access-common/src/lib/guards/department-editor.guard.ts'),'utf8');
const adminUserDto=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-user/src/lib/admin-create-user.dto.ts'),'utf8');
const adminUserService=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-user/src/lib/server-feat-user.service.ts'),'utf8');
const adminHtml=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html'),'utf8');
const mutationSuite=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/test-authenticated-backend-mutations.ps1'),'utf8');
const backendFixture=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/test-data/ensure-backend-mutation-test-fixtures.mjs'),'utf8');
const runner=fs.readFileSync(contractPath(process.cwd(), 'tools/manufacturing/run-all-tests.ps1'),'utf8');

for(const marker of [
  "BLADE_TRACKING: ['45']",
  "CUTTER_BUILDER: ['45']",
  "GREENSHED: ['48']",
  "if (String(role ?? '').toLowerCase() === 'admin') return true",
]){
  if(!policy.includes(marker)) throw new Error(`Department app policy missing ${marker}`);
}

for(const marker of [
  'GEAR_APP_EDIT_METADATA_KEY',
  'canEditGearApp(app, user.role, user.departmentCode)',
  'View-only access:',
  'GEAR_APP_EDITOR_DEPARTMENT_NAMES[app]',
]){
  if(!roleGuard.includes(marker)) throw new Error(`RolesGuard missing department enforcement marker ${marker}`);
}
if(!decorator.includes('SetMetadata(GEAR_APP_EDIT_METADATA_KEY, app)')){
  throw new Error('DepartmentAppEdit must be metadata-only so RolesGuard enforces it after JWT auth.');
}

for(const marker of ['departmentId','departmentCode','departmentDescription']){
  if(!sharedPrincipal.includes(marker) || !jwtPayload.includes(marker) ||
     !jwtStrategy.includes(marker) || !authService.includes(marker)){
    throw new Error(`Department claim ${marker} is not carried through auth/JWT/request context.`);
  }
}

for(const marker of [
  "departmentEditorGuard(app: GearAppKey)",
  "canEditGearApp(app, user.role, user.departmentCode)",
  "queryParams: { viewOnly: '1' }",
  'adminRoleGuard',
]){
  if(!frontendGuard.includes(marker)) throw new Error(`Frontend access guard missing ${marker}`);
}

const controllerRules=[
  ['libs/manufacturing/server/feat-blade/src/lib/server-feat-blade.controller.ts','BLADE_TRACKING'],
  ['libs/manufacturing/server/feat-blade-tray/src/lib/server-feat-blade-tray.controller.ts','BLADE_TRACKING'],
  ['libs/manufacturing/server/feat-container/src/lib/server-feat-container.controller.ts','BLADE_TRACKING'],
  ['libs/manufacturing/server/feat-container-tray/src/lib/server-feat-container-tray.controller.ts','BLADE_TRACKING'],
  ['libs/manufacturing/server/feat-location/src/lib/server-feat-location.controller.ts','BLADE_TRACKING'],
  ['libs/manufacturing/server/feat-location-tray/src/lib/server-feat-location-tray.controller.ts','BLADE_TRACKING'],
  ['libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.controller.ts','BLADE_TRACKING'],
  ['libs/manufacturing/server/feat-cutter-build/src/lib/server-feat-cutter-build.controller.ts','CUTTER_BUILDER'],
  ['libs/manufacturing/server/feat-greenshed/src/lib/server-feat-greenshed.controller.ts','GREENSHED'],
];
for(const [file,app] of controllerRules){
  const text=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  const mutations=[...text.matchAll(/@(Post|Patch|Delete|Put)\([^)]*\)/g)];
  if(!mutations.length) throw new Error(`${file} has no mutating routes to inspect.`);
  for(const match of mutations){
    const after=text.slice(match.index, match.index+180);
    if(!after.includes(`@DepartmentAppEdit('${app}')`)){
      throw new Error(`${file} mutation ${match[0]} is missing DepartmentAppEdit('${app}').`);
    }
  }
}

const routeRules=[
  ['libs/manufacturing/frontend/feature-blade-tracking/src/lib/lib.routes.ts','BLADE_TRACKING',["internal-movement","load-container","receive-container","tray-contents","intake","inventory","all-inventory","locations"]],
  ['libs/manufacturing/frontend/feature-cutter-builder/src/lib/cutter-builder.routes.ts','CUTTER_BUILDER',["build","teardown","lookup"]],
  ['libs/manufacturing/frontend/feature-greenshed/src/lib/greenshed.routes.ts','GREENSHED',["machines","setup","check","pull","lookup"]],
];
for(const [file,app,paths] of routeRules){
  const text=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  for(const path of paths){
    const marker=`departmentEditorGuard('${app}')`;
    const index=text.indexOf(`path: '${path}'`)>=0 ? text.indexOf(`path: '${path}'`) : text.indexOf(`path:'${path}'`);
    if(index<0 || !text.slice(index,index+180).includes(marker)){
      throw new Error(`${file} ${path} must be guarded by ${marker}.`);
    }
  }
}


const dashboardRules=[
  ['libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/dashboard/dashboard.component.html','*ngIf="canEdit"'],
  ['libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/dashboard/cutter-builder-dashboard.component.html','*ngIf="canEdit"'],
  ['libs/manufacturing/frontend/feature-greenshed/src/lib/pages/dashboard/greenshed-dashboard.component.html','*ngIf="canEdit"'],
];
for(const [file,marker] of dashboardRules){
  const html=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  if(!html.includes('[class.view-only-dashboard]="!canEdit"') || !html.includes(marker)){
    throw new Error(`${file} must keep dashboard data visible while suppressing operational actions for view-only users.`);
  }
}

for(const file of [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html',
]){
  const text=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  if(!text.includes('*ngIf="canEdit(user)"') ||
     !text.includes('*ngIf="!canEdit(user)"') ||
     !text.includes('VIEW ONLY') ||
     !text.includes('can view this dashboard')){
    throw new Error(`${file} does not expose dashboard-only/view-only UI state.`);
  }
}

if(!adminUserDto.includes('departmentId!: string') ||
   !adminUserService.includes('departmentId: department.id') ||
   !adminHtml.includes('userForm.departmentId') ||
   !adminHtml.includes('Select department...')){
  throw new Error('Admin user creation must require a department.');
}

for(const marker of [
  "ensureUser(ADMIN_EMAIL,ADMIN_PASSWORD,'admin','99')",
  "ensureUser(USER_EMAIL,USER_PASSWORD,'user','48')",
]){
  if(!backendFixture.includes(marker)) throw new Error(`Backend auth fixture missing ${marker}`);
}
for(const marker of [
  'Cross-department Cutter Builder dashboard allowed',
  'Cross-department Cutter Builder mutation rejected with message',
]){
  if(!mutationSuite.includes(marker)) throw new Error(`Runtime department test missing ${marker}`);
}
if(!runner.includes('$Email = $AdminEmail') || !runner.includes('$Password = $AdminPassword')){
  throw new Error('Cross-app E2E workflow must run as admin because normal users are department-scoped.');
}

console.log('[PASS] Department app-access contract passed: cross-department dashboard view, department-scoped operational edits, and admin bypass are enforced.');
