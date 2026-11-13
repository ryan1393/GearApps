import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(`[FAIL] ${message}`); };

const lib = 'libs/truck-log/web/auth/station';
const project = JSON.parse(read(`${lib}/project.json`));
must(project.name === 'truck-log-web-auth-station', 'station auth library is an Nx project');
for (const tag of ['scope:truck-log', 'platform:web', 'type:auth']) must(project.tags.includes(tag), `station auth library is tagged ${tag}`);

const service = read(`${lib}/src/lib/station-access.service.ts`);
const setup = read(`${lib}/src/lib/station-setup.component.ts`);
const admin = read(`${lib}/src/lib/stations-admin.component.ts`);
const config = read('apps/truck-log/src/app/app.config.ts');
const routes = read('apps/truck-log/src/app/app.routes.ts');
const shell = read('apps/truck-log/src/app/app.component.ts');
const adminAuth = read('libs/truck-log/web/auth/admin/src/lib/admin-auth.service.ts');

// API endpoints follow libs/truck-log/shared/contracts/src/station-access.ts
for (const endpoint of ["`${STATION_ACCESS}/session`", "`${STATION_ACCESS}/pair`", "`${STATION_ACCESS}/sign-out`", '`${STATIONS}/${encodeURIComponent(id)}/pairing-code`', '`${STATIONS}/${encodeURIComponent(id)}/revoke`']) {
  must(service.includes(endpoint), `station service calls ${endpoint}`);
}
must(service.includes("const STATIONS = `${API}/stations`"), 'admin station endpoints live under /api/v1/stations');

// Interceptor: 401 STATION_REQUIRED -> setup, 403 STATION_READ_ONLY -> toast; never loops.
must(/status === 401 && code === 'STATION_REQUIRED'\) station\.redirectToSetup\(\)/.test(service), '401 STATION_REQUIRED redirects to station setup');
must(/status === 403 && code === 'STATION_READ_ONLY'\) station\.notifyReadOnly\(\)/.test(service), '403 STATION_READ_ONLY shows the display-only notice');
must(service.includes("'This is a display-only station.'"), 'display-only notice text');
must(service.includes("const PUBLIC_PATHS = [STATION_SETUP_PATH, '/admin/login']") && service.includes('if (isStationPublicPath(currentUrl) || isStationPublicPath(this.router.url)) return;'), 'setup redirect never loops from /station/setup or /admin/login');
must(service.includes("candidate.startsWith('//')") && service.includes('url.origin !== base'), 'returnTo accepts same-app paths only');
must(service.includes('return throwError(() => error);'), 'interceptor re-throws so pages settle their busy state');
must(/withInterceptors\(\[truckLogAdminInterceptor, truckLogStationInterceptor\]\)/.test(config), 'station interceptor is registered beside the admin interceptor');

// Routes and admin coverage.
must(/path: 'station\/setup', component: StationSetupComponent/.test(routes) && !/path: 'station\/setup'[^\n]*canActivate/.test(routes), '/station/setup is public');
must(/path: 'admin\/stations', component: StationsAdminComponent, canActivate: \[(?:truckLogRoleGuard, )?truckLogAdminGuard\]/.test(routes), '/admin/stations is admin-guarded');
must(/scheduled-loads\|stations\|rxo/.test(adminAuth), 'adminMutation covers /api/v1/stations');
must(adminAuth.includes("'/admin/stations'"), 'safeAdminReturn allows /admin/stations');
must(read('libs/truck-log/web/auth/admin/src/lib/admin-access.component.ts').includes('routerLink="/admin/stations"'), 'admin navigation links to Stations');

// Setup page.
must(setup.includes('Set up this station') && setup.includes('Admin &gt; Stations'), 'setup page title and explanation');
must(setup.includes('STATION_PAIRING_CODE_PATTERN.test(normalized)'), 'pairing code validated with the shared pattern');
must(service.includes(".toUpperCase().replace(/[\\s-]+/g, '')"), 'pairing code uppercased, spaces and dash optional');
must(service.includes("'That code is wrong or has expired. Ask an administrator for a new one.'"), 'invalid code message');
must(service.includes('STATION_PAIR_RATE_LIMITED') && service.includes('Wait a minute'), 'rate-limit message');
must(setup.includes('Administrator? Sign in') && setup.includes('routerLink="/admin/login"'), 'administrator sign-in link');
must(setup.includes("{{busy ? 'Pairing…' : 'Pair'}}"), 'Pair button busy state');

// Admin page.
for (const text of ['Waiting for pairing (code expires', 'Active (last seen', "'Revoked'", 'Add station', 'New pairing code', 'Revoke station', 'Guard station', 'TV display', 'STATION_SETUP_PATH', 'Copy code']) {
  must(admin.includes(text), `stations admin page includes ${text}`);
}
must(admin.includes('tlDialog="tl-revoke-title"'), 'revoke confirmation is an accessible dialog');

// Shell.
must(shell.includes('this.station.load()') && shell.includes('kindLabel(paired.kind)') && shell.includes('Admin session'), 'shell shows the paired station, its role label or admin session');
// Roles: the navigation and routes follow the station kind; dock handhelds get their two screens as tabs.
must(shell.includes('[attr.data-role]="station.role()"') && shell.includes("@if (can('check-in'))") && shell.includes("station.role() === 'DOCK'"), 'shell navigation follows the role');
for (const screen of ['dashboard', 'check-in', 'dock-board', 'active-trucks', 'history', 'rxo', 'rxo-expedite', 'admin', 'tv']) {
  must(routes.includes(`screen: '${screen}'`), `route for ${screen} names its screen for the role guard`);
}
must((routes.match(/truckLogRoleGuard/g) || []).length >= 14, 'every operational route is role-guarded');
const roles = read('libs/truck-log/web/auth/station/src/lib/station-roles.ts');
must(roles.includes("DOCK: ['dock-board', 'history']") && roles.includes("DISPLAY: ['tv']"), 'dock handhelds open only the Dock Board and Records; TVs only TV boards');
for (const text of ['Dock handheld', 'Management (view only)']) must(admin.includes(text), `stations admin page offers ${text}`);
must(shell.includes('{{ version }}') && shell.includes('TRUCK_LOG_VERSION'), 'shell keeps the shared version');

console.log('[PASS] Station sign-in web client follows the shared station-access contract.');
