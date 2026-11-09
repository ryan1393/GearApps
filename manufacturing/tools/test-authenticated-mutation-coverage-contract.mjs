import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('tools/api-route-manifest.json','utf8').replace(/^\uFEFF/,''));
const routes=Array.isArray(manifest)?manifest:manifest.routes;
const key=(method,path)=>`${method.toUpperCase()} ${path}`;

const backendCrud=new Set([
  'POST /api/v1/admin/master-data/models',
  'DELETE /api/v1/admin/master-data/models/:id',
  'POST /api/v1/admin/master-data/machines',
  'DELETE /api/v1/admin/master-data/machines/:id',
  'POST /api/v1/bladeTrays',
  'DELETE /api/v1/bladeTrays/:id',
  'PATCH /api/v1/bladeTrays/:id',
  'POST /api/v1/bladeTrays/batch',
  'POST /api/v1/blades',
  'DELETE /api/v1/blades/:id',
  'PATCH /api/v1/blades/:id',
  'DELETE /api/v1/containerTrays/:id',
  'PATCH /api/v1/containerTrays/:id',
  'POST /api/v1/containers',
  'DELETE /api/v1/containers/:id',
  'PATCH /api/v1/containers/:id',
  'POST /api/v1/cutter-config/blade-requirements',
  'DELETE /api/v1/cutter-config/blade-requirements/:id',
  'PATCH /api/v1/cutter-config/blade-requirements/:id',
  'POST /api/v1/cutter-config/validate-tray',
  'POST /api/v1/locationTrays',
  'DELETE /api/v1/locationTrays/:id',
  'PATCH /api/v1/locationTrays/:id',
  'POST /api/v1/locations',
  'DELETE /api/v1/locations/:id',
  'PATCH /api/v1/locations/:id',
  'POST /api/v1/part-summaries',
  'DELETE /api/v1/part-summaries/:id',
  'PATCH /api/v1/part-summaries/:id',
  'POST /api/v1/parts',
  'PATCH /api/v1/parts/:id',
  'POST /api/v1/roll-masters',
  'PATCH /api/v1/roll-masters/:id',
  'POST /api/v1/trays',
  'DELETE /api/v1/trays/:id',
  'PATCH /api/v1/trays/:id',
  'POST /api/v1/users',
  'DELETE /api/v1/users/:id',
  'PATCH /api/v1/users/:id',
]);

const cutterBodyTransition=new Set([
  'POST /api/v1/cutter-builder/cutter-bodies',
  'PATCH /api/v1/cutter-builder/cutter-bodies/:id/dana-serial',
]);

const fullWorkflow=new Set([
  'POST /api/v1/containerTrays',
  'POST /api/v1/containerTrays/container/:containerId/tray/:trayId/unload',
  'POST /api/v1/cutter-builder/builds',
  'POST /api/v1/cutter-builder/teardowns',
  'POST /api/v1/greenshed/machines/:machineNumber/piece-count',
  'POST /api/v1/greenshed/pull',
  'POST /api/v1/greenshed/quality-check',
  'POST /api/v1/greenshed/setup',
  'POST /api/v1/trays/:id/complete-grinding',
  'POST /api/v1/trays/:id/start-grinding',
]);

const publicAuth=new Set([
  'POST /api/v1/auth/email/forgot-password',
  'POST /api/v1/auth/email/login',
  'POST /api/v1/auth/email/reset-password',
  'POST /api/v1/auth/google/login',
]);

const printerOutput=new Set([
  'POST /api/v1/asset-tags/print',
]);

const allMutationRoutes=new Set(
  routes
    .filter(r=>['POST','PATCH','PUT','DELETE'].includes(String(r.method).toUpperCase()))
    .map(r=>key(r.method,r.path))
);

const covered=new Set([...backendCrud,...cutterBodyTransition,...fullWorkflow,...publicAuth,...printerOutput]);
const missing=[...allMutationRoutes].filter(r=>!covered.has(r));
const stale=[...covered].filter(r=>!allMutationRoutes.has(r));
if(missing.length||stale.length){
  throw new Error(`Mutation coverage map mismatch. Missing=${JSON.stringify(missing)} stale=${JSON.stringify(stale)}`);
}

const backendScript=fs.readFileSync('tools/test-authenticated-backend-mutations.ps1','utf8');
for(const marker of [
  "POST '/admin/master-data/models'",
  'DELETE "/admin/master-data/models/$($adminModel.id)"',
  "POST '/admin/master-data/machines'",
  'DELETE "/admin/master-data/machines/$($adminMachine.id)"',
  "POST '/users'",
  "POST '/part-summaries'",
  "POST '/cutter-config/blade-requirements'",
  "POST '/parts'",
  "POST '/roll-masters'",
  "POST '/locations'",
  "POST '/trays'",
  "POST '/blades'",
  "POST '/bladeTrays'",
  "POST '/bladeTrays/batch'",
  "POST '/locationTrays'",
  "POST '/containers'",
  "PATCH \"/containerTrays/$DirectContainerTrayId\"",
  "PATCH \"/users/$TargetUserId\"",
  "Invoke-ExpectFailure POST '/containerTrays'",
  "Invoke-ExpectFailure POST '/bladeTrays'",
  "Unauthenticated mutation rejected with message",
  "Non-admin mutation rejected with message",
  "Non-admin cutter-body creation rejected with message",
  "Cross-department Cutter Builder dashboard allowed",
  "Cross-department Cutter Builder mutation rejected with message",
  "Assert-NoRecord $current 'Rejected container load rolled back'",
]){
  if(!backendScript.includes(marker)) throw new Error(`Backend mutation suite missing marker: ${marker}`);
}


for(const marker of [
  "function New-AssetSerial",
  "New-AssetSerial 'T'",
  "New-AssetSerial 'C'",
]){
  if(!backendScript.includes(marker)) throw new Error(`Backend mutation suite missing canonical T/C asset serial marker: ${marker}`);
}
for(const stale of [
  "New-Token 'E2E-TRAY'",
  "New-Token 'E2E-BATCH-TRAY'",
  "New-Token 'E2E-MOVE-TRAY'",
  "New-Token 'E2E-CONTAINER'",
  "New-Token 'E2E-CONTAINER-TRAY'",
  "New-Token 'E2E-VALIDATE-TRAY'",
]){
  if(backendScript.includes(stale)) throw new Error(`Backend mutation suite still uses non-canonical T/C asset serial fixture: ${stale}`);
}

for(const safeguard of [
  'test-db-lock-query-contract.mjs',
  'test-fk-relation-sync-contract.mjs',
  'test-error-message-contract.mjs',
  'test-data/test-blade-status-fixture-contract.mjs',
  'test-data/test-part-machine-compatibility-contract.mjs',
]){
  if(!fs.existsSync(`tools/${safeguard}`)) throw new Error(`Required regression safeguard is missing: tools/${safeguard}`);
}

console.log(`[PASS] Mutation coverage map accounts for all ${allMutationRoutes.size} mutating API routes.`);
console.log(`[PASS] Authenticated backend CRUD suite covers ${backendCrud.size} routes; cutter-body transition covers ${cutterBodyTransition.size}; full workflow covers ${fullWorkflow.size}; ${publicAuth.size} public auth routes and ${printerOutput.size} authenticated printer-output route are explicitly classified.`);
