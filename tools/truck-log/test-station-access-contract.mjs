// Station sign-in contract: wiring, public-route allowlist, schema, and the pure
// security helpers (executed after an on-the-fly TypeScript transpile).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { schemaIncludes } from './migration-sql.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let count = 0;
const check = (ok, message) => { assert.ok(ok, message); count++; };

// --- wiring
const lib = 'libs/truck-log/server/auth/station/src/lib';
const moduleSource = read(`${lib}/station-access.module.ts`);
check(moduleSource.includes('{ provide: APP_GUARD, useClass: StationAccessGuard }'), 'station guard is global');
check(read('libs/truck-log/server/core/src/lib/truck-log-server.module.ts').includes('StationAccessModule'), 'server registers station access');
const guard = read(`${lib}/station-access.guard.ts`);
check(guard.includes("'STATION_REQUIRED'") && guard.includes("'STATION_READ_ONLY'") && guard.includes("'STATION_ROLE'"), 'guard refuses unpaired browsers, read-only stations and out-of-role dock handhelds');
check(guard.includes('stationRoleDecision(station.kind, req.method') && guard.includes('this.administratorSignedIn(req)'), 'every paired request goes through the role policy; only a signed-in administrator overrides it');
check(guard.includes('this.admin.session('), 'a signed-in administrator may use guard screens without pairing');
check(guard.includes('originAllowed('), 'cookie-authenticated changes must come from a Truck Log origin');
check(/LOOPBACK\.has\(req\.socket\?\.remoteAddress[\s\S]{0,120}!req\.headers\['x-forwarded-for'\] && !req\.headers\['x-real-ip'\] && !req\.headers\.origin/.test(guard),
  'only in-container loopback requests without proxy or browser headers skip station sign-in');

// Only these routes may skip the station check. Anything new must be added here on purpose.
const allowed = new Map([
  ['libs/truck-log/server/feature/health/src/lib/health.controller.ts', 1],
  ['libs/truck-log/server/feature/print-agents/src/lib/print-agents.controller.ts', 9],
  ['libs/truck-log/server/feature/rxo-documents/src/lib/rxo-documents.controller.ts', 3],
  ['libs/truck-log/server/feature/driver-print/src/lib/driver-print.controller.ts', 1],
  [`${lib}/station-access.controller.ts`, 2],
]);
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith('.ts') ? [full] : [];
  });
}
for (const file of walk(path.join(root, 'libs/truck-log/server'))) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const uses = (fs.readFileSync(file, 'utf8').match(/^\s*@StationPublic\(\)/gm) || []).length;
  if (rel.endsWith('station-policy.ts')) continue;
  check(uses === (allowed.get(rel) ?? 0), `${rel} has ${uses} @StationPublic() routes; expected ${allowed.get(rel) ?? 0}`);
}
const printAgents = read('libs/truck-log/server/feature/print-agents/src/lib/print-agents.controller.ts');
check((printAgents.match(/@StationPublic\(\)\n  @UseGuards\(PrintAgentAuthGuard\)/g) || []).length === 7, 'every Print Agent token route is machine-authenticated');
const rxoDocs = read('libs/truck-log/server/feature/rxo-documents/src/lib/rxo-documents.controller.ts');
check((rxoDocs.match(/@StationPublic\(\)\n  @UseGuards\(TruckLogAccessGuard\)/g) || []).length === 3, 'RXO document token routes are machine-authenticated');
check(!/@StationPublic\(\)[\s\S]{0,200}browser-upload/.test(rxoDocs), 'browser upload requires a station');
const admin = read('libs/truck-log/server/auth/admin/src/lib/admin-auth.module.ts');
check(admin.includes("@SetMetadata('truck-log:station-public', true)\n@Controller('admin-auth')"), 'admin sign-in works before pairing');
check(read(`${lib}/station-policy.ts`).includes("STATION_PUBLIC_METADATA = 'truck-log:station-public'"), 'admin metadata key matches StationPublic');
const visits = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.controller.ts');
check((visits.match(/stationActor\(req,/g) || []).length === 5, 'visit actions record the station, not a browser-supplied name');

// --- schema
for (const marker of ['CREATE TABLE truck_log_stations', 'token_sha256 CHAR(64) UNIQUE', 'pairing_code_sha256 CHAR(64) UNIQUE',
  "kind IN ('GUARD', 'DISPLAY')", "kind IN ('GUARD', 'DOCK', 'MANAGEMENT', 'DISPLAY')", 'ux_truck_log_stations_name', 'CREATE TABLE truck_log_station_events']) {
  check(schemaIncludes(marker), `migrations define ${marker}`);
}

// --- pure helpers, executed
function loadTypeScript() {
  for (const base of [path.join(root, 'package.json'), import.meta.url]) {
    try { return createRequire(base)('typescript'); } catch { /* next */ }
  }
  return null;
}
const ts = loadTypeScript();
if (!ts) {
  console.log('[SKIP] typescript not installed; station helper execution tests skipped.');
} else {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-station-'));
  try {
    const transpile = (rel, out, rewrite = (s) => s) => fs.writeFileSync(path.join(temp, out), rewrite(ts.transpileModule(read(rel), {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText));
    transpile('libs/truck-log/shared/contracts/src/station-access.ts', 'contracts.mjs');
    transpile(`${lib}/station-security.ts`, 'security.mjs', (s) => s.replace(/from '@truck-log\/shared\/contracts'/g, "from './contracts.mjs'"));
    const m = await import(pathToFileURL(path.join(temp, 'security.mjs')).href);

    const code = m.newPairingCode();
    check(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) && !/[01OIL]/.test(code), 'pairing codes avoid look-alike characters');
    check(m.normalizePairingCode(` ${code.toLowerCase()} `) === code.replace('-', ''), 'codes ignore case, spaces and the dash');
    check(m.normalizePairingCode('ABCD-EFG0') === null && m.normalizePairingCode('short') === null && m.normalizePairingCode(42) === null, 'invalid codes are rejected');
    check(m.pairingCodeDigest('ABCDEFGH') !== m.stationTokenDigest('ABCDEFGH'), 'code and token digests use separate labels');
    const token = m.newStationToken();
    check(/^[a-f0-9]{64}$/.test(token), 'tokens are 256-bit hex');

    const http = m.cookieSettings({ TRUCK_LOG_ADMIN_TRANSPORT: 'internal-http' });
    const https = m.cookieSettings({});
    check(http.name === 'TruckLogStation' && !http.secure && https.name === '__Host-TruckLogStation' && https.secure, 'cookie follows the admin transport');
    const cookie = m.stationCookie(token, https);
    check(cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict') && cookie.includes('Secure') && cookie.includes('Path=/'), 'cookie is HttpOnly, SameSite=Strict, Secure over HTTPS');
    check(m.stationTokenFromCookie(`a=1; TruckLogStation=${token}`, http) === token, 'token is read from the Cookie header');
    check(m.stationTokenFromCookie(`TruckLogStation=${token}; TruckLogStation=${token}`, http) === null, 'duplicate station cookies are refused');
    check(m.stationTokenFromCookie('TruckLogStation=not-hex', http) === null, 'malformed tokens are refused');

    const origins = m.allowedOrigins({ TRUCK_LOG_PUBLIC_ORIGIN: 'http://trucklog:4300', TRUCK_LOG_CORS_ORIGINS: 'http://localhost:4300, http://10.0.0.5:4300' });
    check(m.originAllowed({ origin: 'http://trucklog:4300' }, origins), 'configured origin is allowed');
    check(m.originAllowed({}, origins), 'same-origin requests without an Origin header are allowed');
    check(!m.originAllowed({ origin: 'http://evil.test' }, origins), 'foreign origin is refused');
    check(!m.originAllowed({ 'sec-fetch-site': 'cross-site' }, origins), 'cross-site fetches are refused');
    check(!m.originAllowed({ 'sec-fetch-site': 'same-site', origin: 'http://trucklog:8080' }, origins), 'another port on the same host is refused');
    check(m.originAllowed({ 'sec-fetch-site': 'same-origin', origin: 'http://10.1.2.3:4300' }, origins), 'browsers reaching Truck Log by IP can save');
    check(m.originAllowed({ origin: 'http://10.1.2.3:4300', host: '10.1.2.3' }, origins), 'older browsers: Origin matching the requested host is same-origin');
    check(!m.originAllowed({ origin: 'http://evil.test', host: '10.1.2.3' }, origins), 'older browsers: a different host is refused');
    check(m.developmentOpenAccess({ NODE_ENV: 'development', TRUCK_LOG_DEV_OPEN_STATIONS: 'true' }), 'development may skip station sign-in');
    check(!m.developmentOpenAccess({ NODE_ENV: 'production', TRUCK_LOG_DEV_OPEN_STATIONS: 'true' }), 'production never skips station sign-in');

    let now = 0;
    const limiter = new m.AttemptLimiter(2, 1000, () => now);
    check(limiter.attempt('x') && limiter.attempt('x') && !limiter.attempt('x'), 'limiter blocks the third attempt in a window');
    now = 1500;
    check(limiter.attempt('x'), 'limiter recovers after the window');

    assert.throws(() => m.stationName(''), /Station name is required/); count++;
    assert.throws(() => m.stationName('a\u0007b'), /Station name is required/); count++;
    check(m.stationName('  Guard   Shack 1 ') === 'Guard Shack 1', 'station names are trimmed and spaces collapsed');
    assert.throws(() => m.stationKind('ADMIN'), /must be one of GUARD, DOCK, MANAGEMENT, DISPLAY/); count++;
    check(['GUARD', 'DOCK', 'MANAGEMENT', 'DISPLAY'].every((kind) => m.stationKind(kind) === kind), 'every role is a valid station kind');

    // --- role policy, executed: what each kind of station may call
    transpile(`${lib}/station-roles.ts`, 'roles.mjs', (s) => s.replace(/from '@truck-log\/shared\/contracts'/g, "from './contracts.mjs'"));
    const r = await import(pathToFileURL(path.join(temp, 'roles.mjs')).href);
    const decide = (kind, method, url) => r.stationRoleDecision(kind, method, url);
    check(r.apiRoute('/api/v1/visits/12/?x=1') === '/visits/12' && r.apiRoute('/api/v1') === '/', 'routes are matched without the /api/v1 prefix, query or trailing slash');
    const dockAllowed = [
      ['GET', '/api/v1/visits/dock-board'], ['GET', '/api/v1/visits/dock-board?r=1'], ['GET', '/api/v1/visits/history'],
      ['GET', '/api/v1/visits/42'], ['GET', '/api/v1/visits/42/driver-print-package'], ['GET', '/api/v1/visits/documents/7/download'],
      ['GET', '/api/v1/settings/dock-aging'], ['PATCH', '/api/v1/visits/42/dock-complete'],
      ['POST', '/api/v1/visits/42/delivery-number/scan'], ['POST', '/api/v1/visits/42/delivery-number/manual'],
      ['POST', '/api/v1/visits/42/packing-slip'], ['POST', '/api/v1/visits/42/packing-slip/scan'],
      ['POST', '/api/v1/visits/42/packing-slip/scan/preview'], ['POST', '/api/v1/visits/42/packing-slip/scan/attach'],
      ['POST', '/api/v1/visits/42/documents'], ['HEAD', '/api/v1/visits/dock-board'], ['POST', '/api/v1/admin-auth/login'],
    ];
    for (const [method, url] of dockAllowed) check(decide('DOCK', method, url) === 'ALLOW', `dock handheld may ${method} ${url}`);
    const dockRefused = [
      ['POST', '/api/v1/visits'], ['PATCH', '/api/v1/visits/42/final-checkout'], ['GET', '/api/v1/visits/42/slip'],
      ['GET', '/api/v1/visits/dashboard'], ['GET', '/api/v1/visits'], ['GET', '/api/v1/visits/check-in-config'],
      ['POST', '/api/v1/driver-print/visits/42/reprint-rxo'], ['GET', '/api/v1/rxo/control'], ['GET', '/api/v1/rxo/data'],
      ['GET', '/api/v1/reference-data/check-in'], ['PATCH', '/api/v1/settings/dock-aging'], ['GET', '/api/v1/tv/board'],
      ['POST', '/api/v1/docks'], ['GET', '/api/v1/stations'], ['PATCH', '/api/v1/visits/42/dock-complete/extra'],
      ['GET', '/api/v1/visits/abc'], ['DELETE', '/api/v1/visits/42/documents'], ['HEAD', '/api/v1/visits/42/slip'],
    ];
    for (const [method, url] of dockRefused) check(decide('DOCK', method, url) === 'ROLE', `dock handheld may not ${method} ${url}`);
    check(['GET', 'HEAD'].every((m) => decide('MANAGEMENT', m, '/api/v1/visits/dashboard') === 'ALLOW') && decide('MANAGEMENT', 'GET', '/api/v1/rxo/data') === 'ALLOW', 'management can view every screen');
    check(['POST', 'PATCH', 'PUT', 'DELETE'].every((m) => decide('MANAGEMENT', m, '/api/v1/visits/42/dock-complete') === 'READ_ONLY'), 'management can change nothing');
    check(decide('MANAGEMENT', 'POST', '/api/v1/admin-auth/login') === 'ALLOW', 'an administrator can sign in on a management PC');
    check(decide('DISPLAY', 'GET', '/api/v1/tv/board') === 'ALLOW' && decide('DISPLAY', 'POST', '/api/v1/admin-auth/login') === 'READ_ONLY'
      && decide('DISPLAY', 'PATCH', '/api/v1/visits/42/dock-complete') === 'READ_ONLY', 'TV displays stay read-only, as before');
    check(['GET', 'POST', 'PATCH', 'PUT'].every((m) => decide('GUARD', m, '/api/v1/visits/42/final-checkout') === 'ALLOW'), 'guard stations keep the full guard workflow');
    check(decide('SUPERVISOR', 'GET', '/api/v1/visits/dock-board') === 'ROLE', 'an unknown kind gets no access');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

console.log(`[PASS] Station sign-in contract: ${count} checks.`);
