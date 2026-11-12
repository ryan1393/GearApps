import { contractPath } from './lib/contract-paths.mjs';
import { readAdminScreenHtml, readAdminScreenTs } from './lib/admin-screen-source.mjs';
import fs from 'node:fs';

const adminApi=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-admin-users/src/lib/admin-api.service.ts'),'utf8');
// Shell, routes, tabs and shared helpers: none of them may call HttpClient directly.
const adminComponent=readAdminScreenTs();
const cutterController=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-cutter-build/src/lib/server-feat-cutter-build.controller.ts'),'utf8');
const cutterBuildComponent=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.ts'),'utf8');
const cutterBuildHtml=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.html'),'utf8');
const cutterApi=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/data-access-cutter-builder/src/lib/cutter-builder-api.service.ts'),'utf8');
const userService=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-user/src/lib/server-feat-user.service.ts'),'utf8');
const userController=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-user/src/lib/server-feat-user.controller.ts'),'utf8');
const partsController=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-cutter-config/src/lib/server-parts.controller.ts'),'utf8');
const partsService=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/server/feat-cutter-config/src/lib/server-feat-cutter-config.service.ts'),'utf8');

if(adminComponent.includes('inject(HttpClient)') || adminComponent.includes("this.http.")){
  throw new Error('Admin component must not call HttpClient directly; all calls must go through AdminApiService.');
}

for(const method of [
  'listUsers(', 'createUser(', 'listPartSummaries(', 'createPartSummary(',
  'listPartTypes(', 'listParts(', 'createPart(', 'listModels(', 'createModel(',
  'listDepartments(', 'listMachines(', 'createMachine(', 'listCutterBodies(',
  'createCutterBody(', 'assignCutterBodyDanaSerial(',
]){
  if(!adminApi.includes(method)) throw new Error(`AdminApiService missing ${method}`);
}

const createStart=cutterController.indexOf("@Post('cutter-bodies')");
const createEnd=cutterController.indexOf("@Get('cutter-bodies')");
const danaStart=cutterController.indexOf("@Patch('cutter-bodies/:id/dana-serial')");
const danaEnd=cutterController.indexOf("@Get('cutter-bodies/scan");
const listStart=cutterController.indexOf("@Get('cutter-bodies')");
const listEnd=cutterController.indexOf("@Patch('cutter-bodies/:id/dana-serial')");
const scanStart=cutterController.indexOf("@Get('cutter-bodies/scan");

for(const [name,block] of [
  ['create',cutterController.slice(createStart,createEnd)],
  ['Dana assignment',cutterController.slice(danaStart,danaEnd)],
]){
  if(!block.includes('@Auth([RoleType.ADMIN])') || block.includes('RoleType.USER')){
    throw new Error(`Cutter Body ${name} must be ADMIN-only.`);
  }
}

for(const [name,block] of [
  ['list',cutterController.slice(listStart,listEnd)],
  ['scan',cutterController.slice(scanStart)],
]){
  if(!block.includes('RoleType.ADMIN') || !block.includes('RoleType.USER')){
    throw new Error(`Cutter Body ${name} must remain readable by operators and admins.`);
  }
}

if(cutterBuildComponent.includes('assignDanaSerial') ||
   cutterBuildComponent.includes('danaSerialToAssign') ||
   cutterApi.includes('assignDanaSerial(') ||
   cutterBuildHtml.includes('Assign etched Dana S/N')){
  throw new Error('Normal Cutter Builder must not administer cutter-body Dana serials.');
}
if(!cutterBuildHtml.includes('Admin &gt; Cutter Bodies')){
  throw new Error('Cutter Builder must direct unetched-body administration to Admin > Cutter Bodies.');
}

if(!userService.includes('throw new ConflictException(`User ${dto.email} already exists`)') ||
   !userService.includes('createdBy: adminUserId') ||
   !userService.includes('updatedBy: adminUserId') ||
   !userService.includes('departmentId: department.id') ||
   !userController.includes('@ReqUserId() adminUserId: Uuid') ||
   !adminApi.includes('departmentId: string')){
  throw new Error('Admin User creation must use 409 duplicate semantics, audit fields, and a persisted department.');
}

if(!partsController.includes('@ReqUserId() userId: Uuid') ||
   !partsService.includes('createdBy: userId') ||
   !partsService.includes('updatedBy: userId') ||
   !partsService.includes('current.updatedBy = userId')){
  throw new Error('Part create/update must use the same request-user audit pattern as other admin writes.');
}

console.log('[PASS] Admin backend consistency contract passed: centralized calls, normalized audit/error handling, and ADMIN-only Cutter Body mutations.');
