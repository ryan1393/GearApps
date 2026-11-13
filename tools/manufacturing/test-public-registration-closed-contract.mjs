import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(contractPath(process.cwd(), file), 'utf8').replace(/^\uFEFF/, '');
const manifest = JSON.parse(read('tools/manufacturing/api-route-manifest.json'));
const authController = read('libs/manufacturing/server/feat-auth/src/lib/server-feat-auth.controller.ts');
const authService = read('libs/manufacturing/server/feat-auth/src/lib/server-feat-auth.service.ts');
const userController = read('libs/manufacturing/server/feat-user/src/lib/server-feat-user.controller.ts');
const adminApi = read('libs/manufacturing/frontend/feature-admin-users/src/lib/admin-api.service.ts');
// Every frontend source file: no browser code may call public registration.
const frontendRoots = ['libs/manufacturing/frontend', 'libs/client', 'apps/blade-tracking', 'apps/cutter-builder', 'apps/greenshed', 'apps/lapper-client', 'apps/plant-dashboard'];
const frontendSources = [];
const collect = (dir) => {
  const absolute = contractPath(process.cwd(), dir);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') collect(child); }
    else if (/\.(ts|html)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) frontendSources.push([child, read(child)]);
  }
};
frontendRoots.forEach(collect);
if (!frontendSources.some(([file]) => file.includes('data-access-user/src/lib/auth-session.service.ts'))) {
  throw new Error('Frontend source scan did not find the shared AuthSessionService');
}

const forbidden = [
  [authController, "@Post('email/register')", 'Auth controller still exposes public email registration'],
  [authController, 'async register(', 'Auth controller still has the registration action'],
  [authService, 'async registerUser(', 'Auth service still exposes direct email self-registration'],
  ...frontendSources.map(([file, source]) => [source, '/api/v1/auth/email/register', `Frontend ${file} still calls public registration`]),
];

for (const [source, marker, message] of forbidden) {
  if (source.includes(marker)) throw new Error(`${message}: ${marker}`);
}

const registrationRoute = manifest.find(
  (route) => route.method === 'POST' && route.path === '/api/v1/auth/email/register',
);
if (registrationRoute) throw new Error('Route manifest still contains POST /api/v1/auth/email/register');
if (manifest.length !== 125) throw new Error(`Expected 125 API routes after closing public registration; found ${manifest.length}`);

// swagger.json is a generated artifact. The pre-merge cleanup deliberately moves generated
// artifacts outside the Nx source tree before the source-only sweep, so its absence must not
// make a source-only contract fail. If a current generated snapshot is present, validate it;
// otherwise defer generated Swagger verification to the runtime/API validation stage.
if (fs.existsSync(contractPath(process.cwd(), 'swagger.json'))) {
  const swagger = JSON.parse(read('swagger.json'));
  if (swagger.paths?.['/api/v1/auth/email/register']) {
    throw new Error('Swagger still publishes /api/v1/auth/email/register');
  }
  console.log('[PASS] Generated Swagger snapshot also omits public registration.');
} else {
  console.log('[INFO] swagger.json is not present (generated artifact); Swagger validation is deferred to runtime/API verification.');
}

for (const marker of [
  "@Post('')",
  '@Auth([RoleType.ADMIN])',
  'createUserByAdmin(',
]) {
  if (!userController.includes(marker)) throw new Error(`Protected Admin user-creation contract missing marker: ${marker}`);
}
if (!adminApi.includes("this.http.post<AdminUser>('/api/v1/users', input)")) {
  throw new Error('Admin UI is not using protected POST /api/v1/users for account creation');
}

console.log('[PASS] Public self-registration is closed; Admin-only user creation remains available through POST /api/v1/users.');
