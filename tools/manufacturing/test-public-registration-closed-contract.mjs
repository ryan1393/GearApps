import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(contractPath(process.cwd(), file), 'utf8').replace(/^\uFEFF/, '');
const manifest = JSON.parse(read('tools/manufacturing/api-route-manifest.json'));
const authController = read('libs/manufacturing/server/feat-auth/src/lib/server-feat-auth.controller.ts');
const authService = read('libs/manufacturing/server/feat-auth/src/lib/server-feat-auth.service.ts');
const userController = read('libs/manufacturing/server/feat-user/src/lib/server-feat-user.controller.ts');
const adminApi = read('libs/manufacturing/frontend/feature-admin-users/src/lib/admin-api.service.ts');
const userApi = read('libs/manufacturing/frontend/data-access-user/src/lib/user-api.service.ts');
const userFacade = read('libs/manufacturing/frontend/data-access-user/src/lib/user.service.ts');

const forbidden = [
  [authController, "@Post('email/register')", 'Auth controller still exposes public email registration'],
  [authController, 'async register(', 'Auth controller still has the registration action'],
  [authService, 'async registerUser(', 'Auth service still exposes direct email self-registration'],
  [userApi, '/api/v1/auth/email/register', 'Frontend UserApiService still calls public registration'],
  [userFacade, 'addUser(', 'Compatibility UserService still exposes public addUser registration'],
];

for (const [source, marker, message] of forbidden) {
  if (source.includes(marker)) throw new Error(`${message}: ${marker}`);
}

const registrationRoute = manifest.find(
  (route) => route.method === 'POST' && route.path === '/api/v1/auth/email/register',
);
if (registrationRoute) throw new Error('Route manifest still contains POST /api/v1/auth/email/register');
if (manifest.length !== 114) throw new Error(`Expected 114 API routes after closing public registration; found ${manifest.length}`);

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
