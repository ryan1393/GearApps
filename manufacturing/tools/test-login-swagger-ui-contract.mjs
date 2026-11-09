import fs from 'node:fs';

const swagger=fs.readFileSync('apps/server/src/swagger.ts','utf8');
const auth=fs.readFileSync('libs/server/feat-auth/src/lib/server-feat-auth.service.ts','utf8');
const login=fs.readFileSync('libs/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.ts','utf8');
const loginHtml=fs.readFileSync('libs/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.html','utf8');
const start=fs.readFileSync('tools/start-gear-apps.ps1','utf8');

if(!swagger.includes(".addServer('/')")){
  throw new Error('Swagger must use same-origin root server.');
}
if(/addServer\([^)]*API_PREFIX|const server = `http:/.test(swagger)){
  throw new Error('Swagger must not prepend the API prefix or configured hostname to operation paths.');
}
if(!auth.includes("findByEmail(userLoginDto.email)") ||
   !auth.includes("UnauthorizedException('Invalid email or password')")){
  throw new Error('Email login must return a generic 401 for missing/wrong credentials.');
}
for(const marker of [
  "showLocalTestLogin",
  "useLocalTestLogin()",
  "useLocalAdminLogin()",
  "loginError = ''",
  "error: (error: HttpErrorResponse)",
]){
  if(!login.includes(marker)) throw new Error(`Login component missing ${marker}`);
}
for(const marker of [
  'Local accounts',
  '>Operator<',
  '>Admin<',
  '*ngIf="loginError"',
]){
  if(!loginHtml.includes(marker)) throw new Error(`Login template missing ${marker}`);
}
if(!start.includes('ensure-automatic-test-user.mjs') ||
   !start.includes('test@gearapps.local') ||
   !start.includes('admin@gearapps.local')){
  throw new Error('Development launcher must provision local operator + admin accounts.');
}
for(const marker of [
  "['localhost', '127.0.0.1'].includes(window.location.hostname)",
  "readonly localTestEmail = 'test@gearapps.local'",
  "readonly localAdminEmail = 'admin@gearapps.local'",
  'email: this.localTestEmail',
  'email: this.localAdminEmail',
  'if (!this.showLocalTestLogin) return;',
]){
  if(!login.includes(marker)) throw new Error(`Local debug login email-fill missing ${marker}`);
}
for(const forbidden of [
  'GearApps-E2E-Only-2026!',
  'GearApps-Admin-Only-2026!',
  'localTestPassword',
  'localAdminPassword',
  'password: this.localTestPassword',
  'password: this.localAdminPassword',
]){
  if(login.includes(forbidden)) throw new Error(`Frontend local debug login must not ship password marker ${forbidden}`);
}
for(const methodName of ['useLocalTestLogin','useLocalAdminLogin']){
  const startIndex=login.indexOf(`${methodName}(): void {`);
  const endIndex=login.indexOf('\n  }',startIndex);
  const block=startIndex>=0 && endIndex>=0 ? login.slice(startIndex,endIndex+4) : '';
  if(!block || block.includes('password:') || block.includes('this.login()')){
    throw new Error(`${methodName} must fill email only and must not auto-submit.`);
  }
}

console.log('[PASS] Login/Swagger UI runtime contract passed.');
