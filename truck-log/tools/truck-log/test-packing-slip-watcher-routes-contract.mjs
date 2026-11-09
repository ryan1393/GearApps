// Packing-slip watcher routes contract (Truck Log side of the SAP watcher configuration):
// migration and seed, agent and admin endpoints, webpage panel, and the shared
// validation module (executed after an on-the-fly TypeScript transpile).
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

// --- migration, registration and seed
const MIGRATION = '0004_packing_slip_watcher_routes.sql';
const sql = read(`database/truck-log/migrations/${MIGRATION}`);
check(JSON.parse(read('RELEASE-MANIFEST.json')).databaseMigrations.includes(MIGRATION), 'release manifest lists migration 0004');
check(read('docs/truck-log/DATABASE-MIGRATIONS.md').includes(MIGRATION), 'migration docs list migration 0004');
for (const marker of [
  'CREATE TABLE packing_slip_watcher_config', 'CREATE TABLE packing_slip_watcher_routes', 'CREATE TABLE packing_slip_watcher_route_audit',
  "mode IN ('OFF', 'TEST', 'LIVE')", 'route BETWEEN 1 AND 8', "CHECK (mode <> 'LIVE' OR output_printer <> '')",
]) check(schemaIncludes(marker), `schema defines ${marker}`);
check(sql.includes(`output_printer ~ '^\\\\\\\\[A-Za-z0-9._-]+\\\\[^\\\\/:*?"<>|[:cntrl:]]{1,200}$'`), 'database printer check is the contract UNC pattern');
check(/BEFORE UPDATE OR DELETE ON public\.packing_slip_watcher_route_audit/.test(sql), 'audit history is append-only');
check(!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m.test(sql) && !/\b(TRUNCATE|DROP TABLE)\b/i.test(sql), 'migration is plain additive SQL');
check(/VALUES \(1, 1, now\(\), 'migration'\)/.test(sql), 'seed starts at version 1');
const SEED = [
  [1, 'West Dock', '\\\\USFTWPLVPS03\\USFTWP_West_Dock_Ricoh'],
  [2, 'East Dock', '\\\\USFTWPLVPS03\\USFTWP_EastDock_Ricoh'],
  [3, 'Receiving Dock', '\\\\USFTWPLVPS03\\USFTWP_Receiving_Dock'],
  [4, 'Tube Mill Dock', '\\\\USFTWPLVPS03\\USFTWP_Tube_Mill_Dock_Ricoh'],
  [5, 'Forge Dock', '\\\\USFTWPLVPS03\\USFTWP_Forge_Dock_Ricoh'],
  [6, 'North Shipping Dock', '\\\\USFTWPLVPS03\\USFTWP_Shipping_Ricoh_2'],
  [7, 'Scheduling Office', '\\\\USFTWPLVPS03\\USFTWP_Scheduling_Ricoh'],
  [8, 'DGL', '\\\\USFTWPLVPS03\\USFTWP_DGL_Ricoh'],
];
const seeded = [...sql.matchAll(/^\s+\((\d), '([^']+)', '([^']+)', '([^']+)', '(\w+)', (true|false)\)[,;]$/gm)]
  .map((m) => ({ route: Number(m[1]), name: m[2], sourceQueue: m[3], outputPrinter: m[4], mode: m[5], uploadEnabled: m[6] === 'true' }));
check(seeded.length === 8, 'seed has exactly routes 1..8');
for (const [route, name, printer] of SEED) {
  const row = seeded.find((r) => r.route === route);
  check(row && row.name === name && row.outputPrinter === printer, `seed route ${route} is ${name} on ${printer}`);
  check(row.sourceQueue === `SAP-Capture-route${route}` && row.mode === 'TEST' && row.uploadEnabled === false, `seed route ${route} starts TEST, upload off`);
}

// --- server
const lib = 'libs/truck-log/server/feature/print-agents/src/lib';
const agent = read(`${lib}/print-agents.controller.ts`);
check(/@Get\('packing-slip-routes'\)\n  @StationPublic\(\)\n  @UseGuards\(PrintAgentAuthGuard\)\n  @PrintAgentScope\('documents:upload'\)/.test(agent), 'agent endpoint uses the upload credential and scope');
check(agent.includes('response.setHeader(\'ETag\', `"${config.version}"`)') && agent.includes('packingSlipEtagMatches(ifNoneMatch, config.version)') && agent.includes('response.status(304).end()'), 'agent endpoint sends ETag "<version>" and honours If-None-Match');
const admin = read(`${lib}/packing-slip-routes-admin.controller.ts`);
check(admin.includes("@TruckLogAdminWrites()\n@Controller('admin/packing-slip-routes')"), 'admin endpoint uses the admin write guard (session + CSRF)');
check(admin.includes('@Put()') && admin.includes('this.admin.authorize(') && admin.includes('actor.user.username'), 'PUT records the signed-in administrator');
check(!/@StationPublic\(\)/.test(admin), 'admin GET still needs a paired station or administrator');
const moduleSource = read(`${lib}/print-agents.module.ts`);
check(moduleSource.includes('PackingSlipRoutesAdminController') && moduleSource.includes('PackingSlipRoutesService') && moduleSource.includes('TruckLogAdminModule'), 'print-agents module wires the routes service and admin controller');
const service = read(`${lib}/packing-slip-routes.service.ts`);
check(service.includes("WHERE id = 1${lock ? ' FOR UPDATE' : ''}") && service.includes('this.current(q, true)'), 'saves lock the config row');
check(service.includes("code: 'PACKING_SLIP_ROUTES_STALE'") && service.includes('ConflictException'), 'stale version -> 409');
check(service.includes("code: 'PACKING_SLIP_ROUTES_CONFIRM_LIVE'") && service.includes('confirmLiveMatches(newlyLive, confirmLive)'), 'newly LIVE routes need confirmLive -> 400');
check(service.includes("code: 'PACKING_SLIP_ROUTES_INVALID'") && service.includes('validatePackingSlipRoutes('), 'server runs the shared validation');
check(service.includes('INSERT INTO packing_slip_watcher_route_audit') && service.includes('packingSlipRouteChanges('), 'every saved change writes an audit row with before/after per field');
check(service.includes('if (!changes.length) return saved;'), 'a save without changes keeps the version');

// --- web
const authWeb = read('libs/truck-log/web/auth/admin/src/lib/admin-auth.service.ts');
check(authWeb.includes('admin\\/packing-slip-routes'), 'admin interceptor sends CSRF headers on the watcher save');
const api = read('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
check(api.includes('packingSlipRoutes()') && api.includes('this.http.put<PackingSlipRouteConfig>(`${this.base}/admin/packing-slip-routes`'), 'web API reads and saves the routes');
const shell = read('libs/truck-log/web/feature/admin/src/lib/admin.component.ts');
check(shell.includes('<tl-packing-slip-watcher></tl-packing-slip-watcher>'), 'Printing tab hosts the packing slip watcher panel');
const panel = read('libs/truck-log/web/feature/admin/src/lib/packing-slip-watcher.component.ts');
for (const marker of ['class="dana-panel"', 'class="dana-panel-header"', 'class="dana-table-shell"', 'class="dana-table', 'class="dana-input"', 'class="dana-select"',
  'class="dana-check"', 'class="dana-dialog"', 'tlDialog="tl-watcher-live-title"', 'tlDialogRole="alertdialog"', 'class="dana-field-error"', 'dana-status-badge',
  'Route #', 'SAP capture queue', 'Output printer', 'Upload to Truck Log', 'Last changed by']) check(panel.includes(marker), `watcher panel uses ${marker}`);
check(panel.includes('auth.canWrite(); else readOnlyRows'), 'without an administrator the routes are read-only');
check(panel.includes('newlyLivePackingSlipRoutes(') && panel.includes('confirmLive') && panel.includes('liveConfirm'), 'switching to Live opens the confirmation and sends confirmLive');
check(panel.includes('e?.status === 409') && panel.includes('this.load();'), '409 shows a message and reloads');
check(!/\bstyles\s*:/.test(panel) && !/\bstyle="/.test(panel), 'no component styles');
const adminCss = read('libs/truck-log/web/styles/src/styles/admin.css');
const watcherCss = adminCss.slice(adminCss.indexOf('.tl-watcher-table'));
check(watcherCss && !/(color|background|font|shadow|border)\s*:/.test(watcherCss), 'Truck Log CSS adds layout only for the watcher table');

// --- shared validation, executed
function loadTypeScript() {
  for (const base of [path.join(root, 'package.json'), import.meta.url]) {
    try { return createRequire(base)('typescript'); } catch { /* next */ }
  }
  return null;
}
const ts = loadTypeScript();
if (!ts) {
  console.log('[SKIP] typescript not installed; packing-slip route validation execution tests skipped.');
} else {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-log-watcher-'));
  try {
    fs.writeFileSync(path.join(temp, 'routes.mjs'), ts.transpileModule(read('libs/truck-log/shared/contracts/src/packing-slip-routes.ts'), {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    const m = await import(pathToFileURL(path.join(temp, 'routes.mjs')).href);
    const seed = seeded.map((r) => ({ ...r }));
    const valid = m.validatePackingSlipRoutes(seed);
    check(valid.issues.length === 0 && valid.routes.length === 8, 'the migration seed passes the shared validation');
    const issuesFor = (mutate) => { const rows = seed.map((r) => ({ ...r })); mutate(rows); return m.validatePackingSlipRoutes(rows).issues; };
    const has = (issues, route, field) => issues.some((i) => i.route === route && i.field === field);

    const P = m.PACKING_SLIP_PRINTER_PATTERN;
    for (const ok of ['\\\\USFTWPLVPS03\\USFTWP_DGL_Ricoh', '\\\\host.example-1\\Queue Name (2)', `\\\\h\\${'a'.repeat(200)}`]) check(P.test(ok), `UNC accepted: ${ok.slice(0, 40)}`);
    for (const bad of ['USFTWP_DGL_Ricoh', '\\\\host', '\\\\host\\', '\\\\ho st\\q', '\\\\host\\a\\b', '\\\\host\\a/b', '\\\\host\\a:b', '\\\\host\\a\tb', `\\\\h\\${'a'.repeat(201)}`, '\\host\\q']) {
      check(!P.test(bad), `UNC refused: ${JSON.stringify(bad).slice(0, 40)}`);
    }
    check(m.validatePackingSlipRoutes(seed.slice(0, 7)).issues[0]?.field === 'routes', 'exactly 8 routes are required');
    check(issuesFor((r) => { r[1].route = 1; }).some((i) => i.field === 'routes'), 'route numbers are unique');
    check(issuesFor((r) => { r[0].route = 9; }).some((i) => i.field === 'routes'), 'route numbers stay within 1..8');
    check(has(issuesFor((r) => { r[0].name = ''; }), 1, 'name') && has(issuesFor((r) => { r[0].name = 'x'.repeat(61); }), 1, 'name'), 'name is 1-60 characters');
    check(!issuesFor((r) => { r[0].name = 'x'.repeat(60); }).length, 'a 60-character name is fine');
    check(has(issuesFor((r) => { r[0].sourceQueue = 'q'.repeat(121); }), 1, 'sourceQueue') && has(issuesFor((r) => { r[0].sourceQueue = '  '; }), 1, 'sourceQueue'), 'SAP capture queue is 1-120 characters');
    check(has(issuesFor((r) => { r[0].name = 'West\nDock'; }), 1, 'name') && has(issuesFor((r) => { r[0].sourceQueue = 'q\u007f'; }), 1, 'sourceQueue'), 'no control characters anywhere');
    check(has(issuesFor((r) => { r[2].sourceQueue = 'sap-capture-ROUTE2'; }), 3, 'sourceQueue'), 'SAP capture queue is unique across routes that are not OFF (case-insensitive)');
    check(!issuesFor((r) => { r[2].sourceQueue = r[1].sourceQueue; r[2].mode = 'OFF'; }).length, 'an OFF route may share a queue');
    check(!issuesFor((r) => { const q = r[1].sourceQueue; r[1].sourceQueue = r[2].sourceQueue; r[2].sourceQueue = q; }).length, 'two routes may swap queues in one save');
    check(has(issuesFor((r) => { r[7].mode = 'LIVE'; r[7].outputPrinter = ''; }), 8, 'outputPrinter'), 'a LIVE route needs an output printer');
    check(!issuesFor((r) => { r[0].outputPrinter = ''; }).length, 'TEST and OFF routes may have no printer');
    check(has(issuesFor((r) => { r[0].outputPrinter = 'USFTWP_West_Dock_Ricoh'; }), 1, 'outputPrinter'), 'a printer must be a UNC path');
    check(has(issuesFor((r) => { r[0].mode = 'ON'; }), 1, 'mode') && has(issuesFor((r) => { r[0].uploadEnabled = 'yes'; }), 1, 'uploadEnabled'), 'mode and upload flag are typed');
    const trimmed = m.validatePackingSlipRoutes(seed.map((r) => ({ ...r, name: ` ${r.name} ` })));
    check(!trimmed.issues.length && trimmed.routes[0].name === 'West Dock', 'names are trimmed');
    const sorted = m.validatePackingSlipRoutes([...seed].reverse());
    check(sorted.routes.map((r) => r.route).join() === '1,2,3,4,5,6,7,8', 'routes come back sorted by route');

    const next = seed.map((r) => ({ ...r }));
    next[7].mode = 'LIVE'; next[6].mode = 'LIVE';
    check(JSON.stringify(m.newlyLivePackingSlipRoutes(seed, next)) === '[7,8]', 'newly LIVE routes are found');
    check(m.newlyLivePackingSlipRoutes(next, next).length === 0, 'routes already LIVE need no new confirmation');
    check(m.confirmLiveMatches([7, 8], [8, 7]) && m.confirmLiveMatches([], []), 'confirmLive matches in any order');
    check(!m.confirmLiveMatches([7, 8], [8]) && !m.confirmLiveMatches([8], [8, 7]) && !m.confirmLiveMatches([8], [8, 8]) && !m.confirmLiveMatches([8], undefined) && !m.confirmLiveMatches([8], ['8']), 'confirmLive must list exactly the newly LIVE routes');
    const changes = m.packingSlipRouteChanges(seed, next);
    check(changes.length === 2 && changes[1].route === 8 && changes[1].field === 'mode' && changes[1].before === 'TEST' && changes[1].after === 'LIVE', 'changes list before -> after per field');
    check(m.packingSlipEtagMatches('"7"', 7) && m.packingSlipEtagMatches('W/"7"', 7) && m.packingSlipEtagMatches('"6", "7"', 7) && m.packingSlipEtagMatches('*', 7), 'If-None-Match matches the version');
    check(!m.packingSlipEtagMatches('"6"', 7) && !m.packingSlipEtagMatches('7', 7) && !m.packingSlipEtagMatches(undefined, 7), 'a different or unquoted version is not a match');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

console.log(`[PASS] Packing-slip watcher routes contract: ${count} checks.`);
