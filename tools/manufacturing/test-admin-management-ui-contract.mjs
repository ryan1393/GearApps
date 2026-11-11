import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { readGearAppsStyles } from './lib/read-gear-apps-styles.mjs';

const adminTs=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.ts'),
  'utf8'
);
const adminApi=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-admin-users/src/lib/admin-api.service.ts'),
  'utf8'
);
const adminHtml=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html'),
  'utf8'
);
const adminCss=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.css'),
  'utf8'
);
const adminController=fs.readFileSync(
  contractPath(process.cwd(), 'apps/server/src/app/admin-master-data.controller.ts'),
  'utf8'
);
const adminService=fs.readFileSync(
  contractPath(process.cwd(), 'apps/server/src/app/admin-master-data.service.ts'),
  'utf8'
);
const userController=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/server/feat-user/src/lib/server-feat-user.controller.ts'),
  'utf8'
);
const userService=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/server/feat-user/src/lib/server-feat-user.service.ts'),
  'utf8'
);
const partSummaryController=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/server/feat-part-summary/src/lib/server-feat-part-summary.controller.ts'),
  'utf8'
);
const cutterController=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/server/feat-cutter-build/src/lib/server-feat-cutter-build.controller.ts'),
  'utf8'
);
const partsController=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/server/feat-cutter-config/src/lib/server-parts.controller.ts'),
  'utf8'
);
const locationController=fs.readFileSync(
  contractPath(process.cwd(), 'libs/manufacturing/server/feat-location/src/lib/server-feat-location.controller.ts'),
  'utf8'
);
const sharedStyle=readGearAppsStyles();

for(const marker of [
  "activeTab: AdminTab = 'users'",
  'this.api.createUser(',
  'this.api.createPartSummary(',
  'this.api.createPart(',
  'this.api.createModel(',
  'this.api.createMachine(',
  'this.api.createLocation(',
  'this.api.updateLocation(',
  'this.api.createCutterBody(',
  'this.api.assignCutterBodyDanaSerial(',
]){
  if(!adminTs.includes(marker)) throw new Error(`Admin screen is missing shared AdminApiService delegation: ${marker}`);
}

for(const marker of [
  "createUser(",
  "createPartSummary(",
  "createPart(",
  "createModel(",
  "createMachine(",
  "listLocations(",
  "createLocation(",
  "updateLocation(",
  "createCutterBody(",
  "assignCutterBodyDanaSerial(",
  "'/api/v1/users'",
  "'/api/v1/part-summaries'",
  "'/api/v1/parts'",
  "'/api/v1/admin/master-data/models'",
  "'/api/v1/admin/master-data/machines'",
  "'/api/v1/locations'",
  "'/api/v1/cutter-builder/cutter-bodies'",
  "'/api/v1/admin/master-data/departments'",
]){
  if(!adminApi.includes(marker)) throw new Error(`Shared AdminApiService is missing ${marker}`);
}


for(const marker of [
  'MeshForge Administration',
  '>Users<',
  '>Part Summaries<',
  '>Parts<',
  '>Models<',
  '>Machines<',
  '>Locations<',
  '>Cutter Bodies<',
  'Create User',
  'Department',
  'Create Part Summary',
  'Create Part',
  'Create Model',
  'Create Machine',
  'Create Location',
  'Existing Locations',
  'Create Cutter Body',
]){
  if(!adminHtml.includes(marker)) throw new Error(`Admin template is missing ${marker}`);
}


if(adminApi.includes('perPage=200') || adminApi.includes('perPage=500')){
  throw new Error('Admin API service must respect the backend perPage maximum of 50.');
}
if(!adminApi.includes('perPage=${perPage}&page=${page}')){
  throw new Error('Admin API service must own paginated Users/Part Summaries requests.');
}

if(adminCss.replace(/\/\*[\s\S]*?\*\//g,'').trim()){
  throw new Error('Admin feature must not own private styling; use the central Gear Apps stylesheet.');
}

for(const marker of [
  "@Controller({ path: 'admin/master-data', version: '1' })",
  "@Auth([RoleType.ADMIN])",
  "@Get('departments')",
  "@Get('models')",
  "@Post('models')",
  "@Delete('models/:id')",
  "@Get('machines')",
  "@Post('machines')",
  "@Delete('machines/:id')",
]){
  if(!adminController.includes(marker)) throw new Error(`Admin master-data API missing ${marker}`);
}

for(const marker of [
  'DepartmentOrmEntity',
  'ModelOrmEntity',
  'MachineOrmEntity',
  'createModel',
  'createMachine',
  'disableModel',
  'disableMachine',
]){
  if(!adminService.includes(marker)) throw new Error(`Admin master-data service missing ${marker}`);
}

if(!userController.includes("@Post('')") ||
   !userController.includes('@Auth([RoleType.ADMIN])') ||
   !userController.includes('AdminCreateUserDto') ||
   !userController.includes('createUserByAdmin')){
  throw new Error('Existing Users backend was not upgraded with an authenticated admin create route.');
}
if(!userService.includes('async createUserByAdmin') ||
   !userService.includes('role: dto.role') ||
   !userService.includes('departmentId: department.id') ||
   !userService.includes('isEmailVerified: true') ||
   !adminTs.includes('departmentId') ||
   !adminApi.includes('departmentId: string')){
  throw new Error('Admin-created users must preserve role, require department, and start active/verified.');
}

if(!partSummaryController.includes("@Post('')") ||
   !partSummaryController.includes('@Auth([RoleType.ADMIN])')){
  throw new Error('Part Summary admin create endpoint is missing.');
}

if(!partsController.includes('@Controller({ path: \'parts\', version: \'1\' })') ||
   !partsController.includes('@Post()') ||
   !partsController.includes('@Auth([RoleType.ADMIN])')){
  throw new Error('Parts admin screen must use the existing protected Parts API.');
}

if(!locationController.includes("@Post('')") ||
   !locationController.includes("@Patch(':id')") ||
   !locationController.includes('@Auth([RoleType.ADMIN])')){
  throw new Error('Location admin create/update endpoints are missing or not ADMIN-only.');
}

if(!cutterController.includes("@Post('cutter-bodies')") ||
   !cutterController.includes("@Patch('cutter-bodies/:id/dana-serial')")){
  throw new Error('Cutter Body admin create/Dana endpoints are missing.');
}
const cutterCreateBlock=cutterController.slice(
  cutterController.indexOf("@Post('cutter-bodies')"),
  cutterController.indexOf("@Get('cutter-bodies')")
);
const cutterDanaBlock=cutterController.slice(
  cutterController.indexOf("@Patch('cutter-bodies/:id/dana-serial')"),
  cutterController.indexOf("@Get('cutter-bodies/scan")
);
if(!cutterCreateBlock.includes('@Auth([RoleType.ADMIN])') ||
   cutterCreateBlock.includes('RoleType.USER')){
  throw new Error('Cutter Body creation must be ADMIN-only.');
}
if(!cutterDanaBlock.includes('@Auth([RoleType.ADMIN])') ||
   cutterDanaBlock.includes('RoleType.USER')){
  throw new Error('Dana serial assignment must be ADMIN-only.');
}

for(const marker of [
  '.gear-admin-tabs',
  '.gear-admin-layout',
  '.gear-admin-form',
  '.gear-admin-list',
]){
  if(!sharedStyle.includes(marker)) throw new Error(`Central styling missing ${marker}`);
}

for(const nav of [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html',
]){
  const html=fs.readFileSync(contractPath(process.cwd(), nav),'utf8');
  if(!html.includes(`*ngIf="user.role === 'admin'"`) || !html.includes('<span>Admin</span>')){
    throw new Error(`${nav} must show Admin navigation only to admins.`);
  }
}

console.log('[PASS] Admin management UI/API contract passed for Users, Part Summaries, Parts, Models, Machines, Locations, and ADMIN-only Cutter Bodies.');
