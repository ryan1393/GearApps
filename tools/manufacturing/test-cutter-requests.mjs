// Live acceptance checks. Creates auditable test inventory; never run against production.
// MESHFORGE_ALLOW_TEST_ACCOUNTS=YES node --env-file=.env tools/manufacturing/test-cutter-requests.mjs [--browser]
// After restarting the API: ... test-cutter-requests.mjs --verify-restart
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { build as bundle } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.MESHFORGE_BASE_URL || 'http://127.0.0.1:3333/api/v1');
const local = value => ['127.0.0.1', 'localhost', '::1'].includes(value);
if (process.env.MESHFORGE_ALLOW_TEST_ACCOUNTS !== 'YES' ||
    !/(?:^|_)(?:test|cloud_dev)(?:_|$)/i.test(process.env.DATABASE_NAME || '') ||
    !local(process.env.DATABASE_HOST || '') || !local(base.hostname)) {
  throw new Error('Requires MESHFORGE_ALLOW_TEST_ACCOUNTS=YES, a local test/cloud_dev database, and a local API. No production run is allowed.');
}
const connection = { host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT), user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME };
const db = new pg.Client(connection);
const source = new DataSource({ type: 'postgres', ...connection, username: connection.user, entities: [], synchronize: false });
const reportPath = path.join(root, 'tmp/cutter-request-integration-result.json');
let token, checks = 0, calls = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS ' + label); };
async function api(method, endpoint, body, expected = [200, 201], auth = token) {
  const response = await fetch(base.toString().replace(/\/$/, '') + endpoint, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  assert.ok(expected.includes(response.status), `${method} ${endpoint}: ${response.status} ${text.slice(0, 400)}`);
  calls++; return data;
}
const sql = async (query, values = []) => (await db.query(query, values)).rows;
const one = async (query, values = []) => (await sql(query, values))[0];
const all = () => api('GET', '/cutter-builder/requests?includeCompleted=true');
const row = async id => {
  const found = (await all()).find(item => item.id === id);
  assert.ok(found, 'Request remains readable: ' + id); return found;
};
const snapshot = async id => {
  const item = await row(id);
  return { id, requested_quantity: item.requested_quantity, remaining_quantity: item.remaining_quantity, built_quantity: item.built_quantity, status: item.status, notes: item.notes, build_ids: item.build_ids, build_numbers: item.build_numbers, history: await sql('SELECT id,event_type,build_id,quantity_delta FROM cutter_request_history WHERE request_id=$1 ORDER BY occurred_at,id', [id]) };
};
const counts = (item, requested, built, remaining, status) => {
  assert.equal(item.requested_quantity, requested); assert.equal(item.built_quantity, built);
  assert.equal(item.remaining_quantity, remaining); assert.equal(item.status, status);
};
const suffix = crypto.randomBytes(5).toString('hex').toUpperCase();
const requestIds = [], testAccounts = [], roleIds = [];
let browserFixture, retainBrowserFixtures = false;
let serial = BigInt(Date.now()) * 1000n;
let helper, fx, opposite, bodyTemplate;
const create = async (summary, quantity, notes, partType = fx.part_type_code, auth = token) => {
  const result = await api('POST', '/cutter-builder/requests', { summary_id: summary.id, part_type_code: partType, quantity, notes }, [201], auth);
  if (!requestIds.includes(result.id)) requestIds.push(result.id);
  return result;
};
const status = (id, value, expected = [200]) => api('PATCH', `/cutter-builder/requests/${id}/status`, { status: value }, expected);

async function summary(label, bothTypes = true) {
  const id = crypto.randomUUID();
  const number = `RQ-${suffix}-${label}`;
  // Clone current reference rules; quantity here remains the blade count per cutter.
  await sql(`INSERT INTO part_summaries(id,"createdAt","updatedAt",number,revision,model_id,hos,active,enabled)
    SELECT $1,now(),now(),$2,revision,model_id,hos,true,true FROM part_summaries WHERE id=$3`, [id, number, fx.summary_id]);
  await sql(`INSERT INTO cutter_blade_requirements(id,"createdAt","updatedAt",summary_id,part_type_id,required_blade_count,enabled)
    VALUES($1,now(),now(),$2,$3,$4,true)`, [crypto.randomUUID(), id, fx.part_type_id, fx.required_blade_count]);
  if (bothTypes) await sql(`INSERT INTO cutter_blade_requirements(id,"createdAt","updatedAt",summary_id,part_type_id,required_blade_count,enabled)
    VALUES($1,now(),now(),$2,$3,$4,true)`, [crypto.randomUUID(), id, opposite.id, fx.required_blade_count]);
  await sql(`INSERT INTO cutter_summary_body_rules(summary_id,body_rule) SELECT $1,body_rule FROM cutter_summary_body_rules WHERE summary_id=$2`, [id, fx.summary_id]);
  await sql(`INSERT INTO part_summary_part_type_blades(summary_id,part_type_id,hos,inner_blade,outer_blade,source)
    SELECT $1,part_type_id,hos,inner_blade,outer_blade,'cutter-request live acceptance fixture' FROM part_summary_part_type_blades WHERE summary_id=$2`, [id, fx.summary_id]);
  return { id, number };
}

async function prepare(summaryRef) {
  const tray = await api('POST', '/trays', { serial_number: 'T' + ++serial, enabled: true }, [201]);
  await api('POST', '/bladeTrays/opening-inventory', { tray_serial_number: tray.serial_number, summary_id: summaryRef.id, part_type_id: fx.part_type_id, stage: 'READY_FOR_CUTTER', shelf_serial_number: fx.shelves.finished, service_cycle: 0 }, [201]);
  // New physical body, with the fixture's validated Dana size/hand and definition.
  const prefix = bodyTemplate.dana_serial_number.replace(/[A-F0-9]{6}$/, '');
  const body = prefix + crypto.randomBytes(3).toString('hex').toUpperCase();
  await sql(`INSERT INTO cutter_bodies(id,"createdAt","updatedAt",dana_serial_number,mf_serial_number,definition_id,description,enabled)
    VALUES($1,now(),now(),$2,$3,$4,$5,true)`, [crypto.randomUUID(), body, `RQ-${crypto.randomUUID()}`, bodyTemplate.definition_id, 'Cutter request acceptance ' + suffix]);
  return { summary: summaryRef, tray, body, input: { cutter_body_identifier: body, tray_serial_number: tray.serial_number, cutter_builder_machine_id: fx.cutter_builder_machine_id, honed: false, coated: true, comments: 'Cutter request acceptance ' + suffix } };
}

async function assemble(prepared, expected = [201]) {
  const result = await api('POST', '/cutter-builder/builds', prepared.input, expected);
  if (!result.build) return result;
  const built = result.build;
  const evidence = await one(`SELECT b.id,b.built_at,b.completed_at,s.code AS status_code,
    (SELECT count(*)::integer FROM cutter_events e JOIN cutter_event_types t ON t.id=e.event_type_id
      WHERE e.cutter_build_id=b.id AND t.code='CB' AND e."deletedAt" IS NULL) AS build_events
    FROM cutter_builds b JOIN cutter_build_statuses s ON s.id=b.status_id WHERE b.id=$1`, [built.cutter_build_id]);
  assert.ok(evidence?.built_at); assert.equal(evidence.completed_at, null); assert.equal(evidence.status_code, 'READY');
  assert.ok(evidence.build_events >= 1);
  return { id: built.cutter_build_id, number: built.build_number, prepared };
}

async function replay(build, summaryRef, times = 2) {
  const results = await Promise.allSettled(Array.from({ length: times }, () => source.transaction('READ COMMITTED', manager =>
    helper.allocateCutterRequest(manager, { buildId: build.id, summaryId: summaryRef.id, partTypeId: fx.part_type_id }, 'request-integration-test'))));
  for (const result of results) assert.equal(result.status, 'fulfilled', String(result.reason));
}

async function voidBuild(build) {
  const undo = await api('GET', '/workflow-cancellation/cutter-builder?identifier=' + encodeURIComponent(build.number));
  assert.ok(undo.latest?.can_cancel, 'Creation remains eligible for Cancel Last');
  const body = { identifier: build.number, operation_id: undo.latest.id, reason: 'Cutter request live acceptance build void' };
  await api('POST', '/workflow-cancellation/cutter-builder', body, [201, 200]);
  await api('POST', '/workflow-cancellation/cutter-builder', body, [409]);
  return body;
}

async function inventorySnapshot(build) {
  return one(`SELECT to_jsonb(b) AS build,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM cutter_build_blades x WHERE x.cutter_build_id=b.id) AS assignments,
    (SELECT jsonb_agg(to_jsonb(z) ORDER BY z.id) FROM blades z JOIN cutter_build_blades x ON x.blade_id=z.id WHERE x.cutter_build_id=b.id) AS blades,
    (SELECT to_jsonb(t) FROM trays t WHERE t.id=$2) AS tray
    FROM cutter_builds b WHERE b.id=$1`, [build.id, build.prepared.tray.id]);
}

async function browserChecks(openRequest, readyRequest, access) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const origin = process.env.MESHFORGE_CUTTER_WEB_URL || process.env.MESHFORGE_WEB_URL || 'http://127.0.0.1:4201';
  const greenshedOrigin = process.env.MESHFORGE_GREENSHED_WEB_URL || 'http://127.0.0.1:4202';
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try {
    for (const route of ['/cutter-builder/requests', '/greenshed/cutter-requests']) {
      const routeOrigin = route.startsWith('/greenshed/') ? greenshedOrigin : origin;
      await page.goto(routeOrigin + '/login');
      await page.evaluate(value => localStorage.setItem('app-access-token', value), token);
      await page.goto(routeOrigin + route);
      await page.getByRole('heading', { name: 'Cutter Requests', exact: true }).waitFor();
      const table = page.getByRole('table', { name: 'Cutter request queue' });
      await table.getByRole('row').filter({ hasText: openRequest.number }).waitFor();
      await table.getByRole('row').filter({ hasText: readyRequest.number }).waitFor();
      check(await page.getByRole('link', { name: 'Cutter Requests', exact: true }).count() > 0, 'Navigation exposes ' + route);
      await page.reload(); await table.getByRole('row').filter({ hasText: openRequest.number }).waitFor();
      check(true, 'Direct route and refresh retain queue: ' + route);
    }
    const form = page.getByRole('form', { name: 'New cutter request' });
    await form.getByLabel(/^Part Summary/).selectOption(openRequest.id);
    await form.getByLabel(/^Part Type/).selectOption(fx.part_type_code);
    await form.getByLabel(/^Quantity \(cutters\)/).fill('0');
    check(await page.getByRole('button', { name: 'Request cutters', exact: true }).isDisabled(), 'Browser prevents zero cutter quantity');
    await form.getByLabel(/^Quantity \(cutters\)/).fill('2');
    await form.getByLabel(/^Notes/).fill('Browser request ' + suffix);
    await page.getByRole('button', { name: 'Request cutters', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /saved|added|requested/i }).first().waitFor();
    const saved = (await all()).find(item => item.summary_id === openRequest.id && !['COMPLETED', 'CANCELED'].includes(item.status));
    check(saved?.notes === 'Browser request ' + suffix, 'Browser request form persists notes and quantity');
    const readyRow = page.getByRole('row').filter({ hasText: readyRequest.number });
    await readyRow.getByRole('button', { name: 'Complete', exact: true }).click();
    await page.getByRole('button', { name: 'Complete request', exact: true }).click();
    check((await row(readyRequest.requestId)).status === 'COMPLETED', 'Browser Ready-only Complete closes request');
    check(errors.length === 0, 'Both rendered screens have no JavaScript errors: ' + errors.join('; '));
    await fs.mkdir(path.join(root, 'tmp/cutter-request-screenshots'), { recursive: true });
    await page.evaluate(async () => { window.scrollTo(0, 0); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    await page.screenshot({ path: path.join(root, 'tmp/cutter-request-screenshots/greenshed-requests.png'), fullPage: true });
    await page.goto(origin + '/cutter-builder/requests');
    await page.getByRole('table', { name: 'Cutter request queue' }).waitFor();
    await page.evaluate(async () => { window.scrollTo(0, 0); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    await page.screenshot({ path: path.join(root, 'tmp/cutter-request-screenshots/cutter-builder-requests.png'), fullPage: true });
    for (const [routeOrigin, route] of [[origin, '/cutter-builder/requests'], [greenshedOrigin, '/greenshed/cutter-requests']]) {
      await page.goto(routeOrigin + '/login');
      await page.evaluate(value => localStorage.setItem('app-access-token', value), access.readToken);
      await page.goto(routeOrigin + route);
      await page.getByRole('table', { name: 'Cutter request queue' }).waitFor();
      check(await page.getByRole('link', { name: 'Cutter Requests', exact: true }).count() > 0 &&
        await page.getByRole('form', { name: 'New cutter request' }).count() === 0 &&
        await page.getByRole('button', { name: /^(Complete|Cancel)$/ }).count() === 0,
      'Read-only role sees queue/navigation and no mutation controls: ' + route);
    }
    await api('PATCH', `/admin/access/roles/${access.role.id}`, { name: access.role.name, permissions: [], enabled: true }, [200]);
    const deniedToken = (await api('POST', '/auth/email/login', { email: access.email, password: access.password }, [200], null)).accessToken;
    let forbiddenReads = 0;
    page.on('request', request => { if (request.url().includes('/api/v1/cutter-builder/requests')) forbiddenReads++; });
    for (const [routeOrigin, route] of [[origin, '/cutter-builder/requests'], [greenshedOrigin, '/greenshed/cutter-requests']]) {
      await page.goto(routeOrigin + '/login');
      await page.evaluate(value => localStorage.setItem('app-access-token', value), deniedToken);
      await page.goto(routeOrigin + route);
      await page.getByRole('alert').filter({ hasText: 'Your role cannot view cutter requests' }).waitFor();
      check(await page.getByRole('link', { name: 'Cutter Requests', exact: true }).count() === 0 &&
        await page.getByRole('table', { name: 'Cutter request queue' }).count() === 0,
      'Role without read permission hides request navigation and denies direct page: ' + route);
    }
    check(forbiddenReads === 0, 'Denied request pages do not fetch queue data');
  } finally { await browser.close(); }
}

async function permissionChecks(ref) {
  await api('GET', '/cutter-builder/requests', undefined, [401], null);
  const catalog = await api('GET', '/admin/access/catalog');
  const read = catalog.find(item => item.key.endsWith(':listCutterRequests'));
  assert.ok(read, 'Request read action registered in role catalog');
  const password = 'Rq1!' + crypto.randomBytes(20).toString('hex');
  const departments = await api('GET', '/admin/master-data/departments');
  const otherDepartment = departments.find(item => item.enabled && !['45', '48'].includes(item.code));
  assert.ok(otherDepartment, 'An enabled department outside Cutter Grind / Gear Quality exists');
  const account = await api('POST', '/users', { email: `rq-${suffix}@example.com`, password, firstName: 'Request', lastName: 'Acceptance', role: 'user', departmentId: otherDepartment.id }, [201]);
  testAccounts.push(account.id);
  const readRole = await api('POST', '/admin/access/roles', { name: 'Request read acceptance ' + suffix, permissions: [read.key], enabled: true }, [201]);
  roleIds.push(readRole.id);
  await api('PUT', `/admin/access/users/${account.id}/role`, { role_id: readRole.id }, [200]);
  const userToken = (await api('POST', '/auth/email/login', { email: account.email, password }, [200], null)).accessToken;
  await api('GET', '/cutter-builder/requests', undefined, [200], userToken);
  await api('POST', '/cutter-builder/requests', { summary_id: ref.id, part_type_code: fx.part_type_code, quantity: 1 }, [403], userToken);
  await api('PATCH', `/cutter-builder/requests/${requestIds[0]}/status`, { status: 'CANCELED' }, [403], userToken);
  check(true, 'Custom screen/action role permits reads and rejects unauthorized mutations');
  await api('PUT', `/admin/access/users/${account.id}/role`, { role_id: null }, [200]);
  const legacyToken = (await api('POST', '/auth/email/login', { email: account.email, password }, [200], null)).accessToken;
  const request = await create(ref, 1, 'Other-department active user attribution', fx.part_type_code, legacyToken);
  check(request.requested_by === account.id, 'Recovered active-user access and requester attribution work outside department 45/48');
  await status(request.id, 'CANCELED');
  await api('PUT', `/admin/access/users/${account.id}/role`, { role_id: readRole.id }, [200]);
  const readToken = (await api('POST', '/auth/email/login', { email: account.email, password }, [200], null)).accessToken;
  return { readToken, role: readRole, email: account.email, password };
}

await db.connect();
try {
  token = (await api('POST', '/auth/email/login', { email: process.env.MESHFORGE_ADMIN_EMAIL || 'admin@example.com', password: process.env.MESHFORGE_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD }, [200], null)).accessToken;
  assert.ok(token, 'Administrator sign-in succeeded');
  if (process.argv.includes('--verify-restart')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(report.database, connection.database);
    assert.equal(report.completed, true, 'Complete the full acceptance run before restart verification');
    for (const before of report.persisted) assert.deepEqual(await snapshot(before.id), before, 'Persistence after API restart: ' + before.id);
    check(true, 'Requests, quantities, build evidence, terminal states, and history survive application restart');
    console.log(`PASS Cutter Requests restart verification (${report.persisted.length} records)`);
  } else if (process.argv.includes('--browser-only')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(report.database, connection.database);
    assert.ok(report.browserFixture, 'Run the full suite once to prepare browser fixtures');
    fx = report.fixture;
    opposite = await one('SELECT id,code FROM part_types WHERE code=$1 AND enabled=true', [fx.part_type_code === 'RING' ? 'PINION' : 'RING']);
    browserFixture = report.browserFixture;
    assert.equal((await row(browserFixture.readyRequest.requestId)).status, 'READY', 'Browser retry needs the retained Ready fixture from an incomplete browser run');
    requestIds.push(...report.requestIds);
    const access = await permissionChecks(await summary('BROWSERACCESS'));
    retainBrowserFixtures = true;
    await browserChecks(browserFixture.openRequest, browserFixture.readyRequest, access);
    retainBrowserFixtures = false;
    for (const id of requestIds) {
      const current = await row(id);
      if (!['COMPLETED', 'CANCELED'].includes(current.stored_status || current.status)) await status(id, 'CANCELED');
    }
    report.completed = true;
    report.persisted = await Promise.all(requestIds.map(snapshot));
    report.checks += checks; report.calls += calls;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS Cutter Requests browser retry (${checks} checks). Restart verification is ready.`);
  } else {
    const fixtureOutput = execFileSync(process.execPath, [path.join(root, 'tools/manufacturing/test-data/ensure-workflow-test-fixtures.mjs')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    fx = JSON.parse(fixtureOutput.trim().split(/\r?\n/).pop());
    opposite = await one(`SELECT id,code FROM part_types WHERE code=$1 AND enabled=true`, [fx.part_type_code === 'RING' ? 'PINION' : 'RING']);
    assert.ok(opposite); bodyTemplate = await one('SELECT dana_serial_number,definition_id FROM cutter_bodies WHERE dana_serial_number=$1', [fx.cutter_body_serial_number]);
    assert.ok(bodyTemplate);
    await source.initialize();
    const helperFile = path.join(root, 'tmp/cutter-request-helper-' + suffix + '.mjs');
    await bundle({ entryPoints: [path.join(root, 'libs/manufacturing/server/data-access/src/lib/cutter-request-allocation.ts')], outfile: helperFile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
    helper = await import(pathToFileURL(helperFile).href);

    const main = await summary('MAIN');
    const missingPair = await summary('SINGLE', false);
    for (const quantity of [0, -1, 1.5, 100, '2', null]) await api('POST', '/cutter-builder/requests', { summary_id: main.id, part_type_code: fx.part_type_code, quantity }, [422]);
    await api('POST', '/cutter-builder/requests', { summary_id: crypto.randomUUID(), part_type_code: fx.part_type_code, quantity: 1 }, [422]);
    await api('POST', '/cutter-builder/requests', { summary_id: main.id, part_type_code: 'INVALID', quantity: 1 }, [422]);
    await api('POST', '/cutter-builder/requests', { summary_id: missingPair.id, part_type_code: opposite.code, quantity: 1 }, [422]);
    check(true, 'Server rejects invalid references, incompatible Summary/Part Type, and noninteger/out-of-range quantities');
    const first = await create(main, 3, 'Original notes');
    const before = await row(first.id); counts(before, 3, 0, 3, 'REQUESTED');
    check(Boolean(before.requested_by && before.requested_by_name && before.requested_at), 'Queue includes requester attribution');
    const wrongType = await create(main, 1, 'Must not receive other part type', opposite.code);
    const different = await summary('DIFFERENT'); const wrongSummary = await create(different, 1, 'Must not receive other summary');
    const prepared = await prepare(main);
    counts(await row(first.id), 3, 0, 3, 'IN_PROGRESS');
    counts(await row(wrongType.id), 1, 0, 1, 'REQUESTED'); counts(await row(wrongSummary.id), 1, 0, 1, 'REQUESTED');
    check(true, 'Matching nonempty tray starts In Progress with Built 0; both identities are required');
    try {
      await sql('UPDATE trays SET enabled=false WHERE id=$1', [prepared.tray.id]);
      counts(await row(first.id), 3, 0, 3, 'REQUESTED');
      check(true, 'Disabled loaded tray does not start work; display can return to Requested before any build');
    } finally { await sql('UPDATE trays SET enabled=true WHERE id=$1', [prepared.tray.id]); }
    await api('POST', '/cutter-builder/builds', { ...prepared.input, cutter_body_identifier: 'INVALID-BODY' }, [404, 422]);
    counts(await row(first.id), 3, 0, 3, 'IN_PROGRESS');
    const firstBuild = await assemble(prepared);
    let item = await row(first.id); counts(item, 3, 1, 2, 'IN_PROGRESS');
    assert.deepEqual(item.build_ids, [firstBuild.id]); assert.deepEqual(item.build_numbers, [firstBuild.number]);
    counts(await row(wrongType.id), 1, 0, 1, 'REQUESTED'); counts(await row(wrongSummary.id), 1, 0, 1, 'REQUESTED');
    check(true, 'Successful physical assembly allocates one cutter and preserves UUID/build-number evidence');
    await replay(firstBuild, main, 3); counts(await row(first.id), 3, 1, 2, 'IN_PROGRESS');
    await api('POST', '/cutter-builder/builds', prepared.input, [409, 422]);
    check((await sql("SELECT id FROM cutter_request_history WHERE build_id=$1 AND event_type='AUTO_FULFILLED'", [firstBuild.id])).length === 1, 'Repeated/concurrent completion delivery and repeated assembly cannot count twice');
    const merged = await create(main, 2, '   '); assert.equal(merged.id, first.id);
    item = await row(first.id); counts(item, 5, 1, 4, 'IN_PROGRESS'); assert.equal(item.notes, 'Original notes');
    assert.equal(item.requested_by, before.requested_by); assert.equal(item.requested_at, before.requested_at);
    await create(main, 1, 'Later notes retained by reversal'); counts(await row(first.id), 6, 1, 5, 'IN_PROGRESS');
    check(true, 'Merged quantity preserves original requester/time; blank notes preserve and nonblank notes replace');
    await sql(`INSERT INTO cutter_request_history(id,request_id,build_id,event_type,user_id,quantity_delta)
      VALUES($1,$2,$3,'AUTO_FULFILLED','legacy-test',-1)`, [crypto.randomUUID(), first.id, firstBuild.id]);
    counts(await row(first.id), 6, 1, 5, 'IN_PROGRESS');
    check(true, 'Surviving duplicate historical evidence is retained while Built counts distinct builds');
    await status(first.id, 'COMPLETED'); counts(await row(first.id), 6, 1, 5, 'COMPLETED');
    assert.equal((await row(first.id)).completed_at, null);
    await status(first.id, 'REQUESTED', [409]); await status(first.id, 'CANCELED', [409]);
    check(!(await api('GET', '/cutter-builder/requests')).some(value => value.id === first.id), 'Manual Complete is terminal, preserves partial quantities/completed_at, and leaves default open queue');
    await voidBuild(firstBuild); item = await row(first.id); counts(item, 6, 0, 6, 'COMPLETED');
    assert.equal(item.notes, 'Later notes retained by reversal');
    check((await sql("SELECT id FROM cutter_request_history WHERE build_id=$1 AND event_type='AUTO_FULFILLMENT_REVERSED'", [firstBuild.id])).length === 1, 'Eligible build void compensates once, preserving later additions, notes, terminal state and original evidence');

    const large = await summary('LARGE'); const total = await create(large, 99); await create(large, 99);
    counts(await row(total.id), 198, 0, 198, 'REQUESTED'); check(true, 'Per-submission limit permits valid cumulative quantity above 99');
    await status(total.id, 'READY'); counts(await row(total.id), 198, 0, 198, 'REQUESTED');
    check(true, 'A stored Ready flag cannot display premature readiness without the completed build evidence');
    const cancelRef = await summary('CANCEL'); const cancelRequest = await create(cancelRef, 2, 'Cancel partial');
    const cancelBuild = await assemble(await prepare(cancelRef));
    const physical = await inventorySnapshot(cancelBuild); await status(cancelRequest.id, 'CANCELED');
    assert.deepEqual(await inventorySnapshot(cancelBuild), physical); counts(await row(cancelRequest.id), 2, 1, 1, 'CANCELED');
    check(true, 'Request cancellation after partial fulfillment preserves physical cutter/blade inventory and linked build');
    await voidBuild(cancelBuild); counts(await row(cancelRequest.id), 2, 0, 2, 'CANCELED'); check(true, 'Build void after request cancellation preserves Canceled while restoring allocation once');

    const fifo = await summary('FIFO'); const old = await create(fifo, 1);
    const newer = crypto.randomUUID(); requestIds.push(newer);
    await sql(`INSERT INTO cutter_requests(id,summary_id,part_type_id,requested_quantity,remaining_quantity,status,requested_by,updated_by,requested_at,updated_at)
      VALUES($1,$2,$3,1,1,'REQUESTED',$4,$4,clock_timestamp()+interval '1 second',clock_timestamp())`, [newer, fifo.id, fx.part_type_id, before.requested_by]);
    await sql(`INSERT INTO cutter_request_history(id,request_id,event_type,user_id,quantity_delta) VALUES($1,$2,'CREATED',$3,1)`, [crypto.randomUUID(), newer, before.requested_by]);
    const fifoBuild = await assemble(await prepare(fifo)); counts(await row(old.id), 1, 1, 0, 'READY'); counts(await row(newer), 1, 0, 1, 'REQUESTED');
    const addOldest = await create(fifo, 1); assert.equal(addOldest.id, newer);
    check(true, 'Oldest matching open request receives first build; Ready/zero row is not reused by quantity merge');
    const beforeCancelReady = await inventorySnapshot(fifoBuild); await status(old.id, 'CANCELED');
    counts(await row(old.id), 1, 1, 0, 'CANCELED'); assert.deepEqual(await inventorySnapshot(fifoBuild), beforeCancelReady);
    check(true, 'Cancel after automatic Ready retains built evidence and inventory');

    const race = await summary('RACE'); const racingRequest = await create(race, 1);
    const pa = await prepare(race), pb = await prepare(race);
    const competed = await Promise.allSettled([assemble(pa), assemble(pb)]);
    const builds = [];
    for (let index = 0; index < competed.length; index++) {
      const result = competed[index];
      if (result.status === 'fulfilled') builds.push(result.value);
      else {
        assert.match(String(result.reason), /409|record is being changed|serialize|deadlock/i);
        builds.push(await assemble(index === 0 ? pa : pb));
      }
    }
    counts(await row(racingRequest.id), 1, 1, 0, 'READY');
    const allocations = await sql('SELECT build_id,request_id FROM cutter_request_build_allocations WHERE build_id=ANY($1::uuid[])', [builds.map(value => value.id)]);
    assert.equal(allocations.filter(value => value.request_id === racingRequest.id).length, 1); assert.equal(allocations.filter(value => value.request_id === null).length, 1);
    check(true, 'Concurrent physical builds cannot overfill the last unit; unmatched build completes normally');
    const afterRace = await create(race, 1); assert.notEqual(afterRace.id, racingRequest.id);
    // Temporarily withhold completion evidence inside a rolled-back transaction. The
    // real physical build and immutable allocation ledger are unchanged after this probe.
    const noMatch = builds.find(build => allocations.find(value => value.build_id === build.id)?.request_id === null);
    const runner = source.createQueryRunner();
    await runner.connect(); await runner.startTransaction('READ COMMITTED');
    try {
      await runner.query('DELETE FROM cutter_request_build_allocations WHERE build_id=$1', [noMatch.id]);
      await runner.query(`UPDATE cutter_events SET "deletedAt"=clock_timestamp() WHERE cutter_build_id=$1
        AND event_type_id IN (SELECT id FROM cutter_event_types WHERE code='CB')`, [noMatch.id]);
      assert.equal(await helper.allocateCutterRequest(runner.manager, { buildId: noMatch.id, summaryId: race.id, partTypeId: fx.part_type_id }, 'request-integration-test'), null);
      assert.equal((await runner.query('SELECT remaining_quantity FROM cutter_requests WHERE id=$1', [afterRace.id]))[0].remaining_quantity, 1);
      assert.equal((await runner.query('SELECT build_id FROM cutter_request_build_allocations WHERE build_id=$1', [noMatch.id])).length, 0);
      check(true, 'Incomplete assembly without an authoritative successful build event cannot allocate');
    } finally { await runner.rollbackTransaction(); await runner.release(); }
    await Promise.all(builds.map(build => replay(build, race, 2))); counts(await row(afterRace.id), 1, 0, 1, 'REQUESTED');
    check(true, 'No-match completion sentinel prevents retry from backfilling a newer request');

    // Use one genuine new request/build through normal use, pull and teardown.
    const lifecycle = await summary('LIFECYCLE'); const lifecycleRequest = await create(lifecycle, 1);
    const lifecycleBuild = await assemble(await prepare(lifecycle));
    const part = 'RQ-PART-' + suffix;
    await sql(`INSERT INTO parts(id,"createdAt","updatedAt",part_number,summary_id,part_type_id,active,enabled)
      VALUES($1,now(),now(),$2,$3,$4,true,true)`, [crypto.randomUUID(), part, lifecycle.id, fx.part_type_id]);
    await api('POST', '/greenshed/setup', { build_number: lifecycleBuild.number, machine_number: fx.machine_number, part_number: part, shift: 'TEST', starting_piece_count: 0, comments: 'request integration lifecycle' });
    await api('POST', '/greenshed/pull', { build_number: lifecycleBuild.number, reason_code: fx.teardown_reason_code, comments: 'request integration pull' });
    const teardownTray = await api('POST', '/trays', { serial_number: 'T' + ++serial, enabled: true }, [201]);
    await api('POST', '/cutter-builder/teardowns', { build_number: lifecycleBuild.number, teardown_tray_serial_number: teardownTray.serial_number, shelf_location_serial_number: fx.shelves.dull, scrapped_blade_count: 0, comments: 'request integration teardown' });
    counts(await row(lifecycleRequest.id), 1, 1, 0, 'READY');
    const tdUndo = await api('GET', '/workflow-cancellation/cutter-builder?identifier=' + encodeURIComponent(lifecycleBuild.number));
    assert.equal(tdUndo.latest?.can_cancel, false);
    check(true, 'Ordinary setup, pull and teardown preserve fulfillment; later physical activity blocks creation undo');

    const browserRef = await summary('BROWSER'); const browserOpen = await create(browserRef, 1, 'Shared queue browser fixture');
    const access = await permissionChecks(await summary('ACCESS'));
    browserFixture = { openRequest: { ...browserRef, requestId: browserOpen.id }, readyRequest: { ...lifecycle, requestId: lifecycleRequest.id } };
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    const fixture = { summary_id: fx.summary_id, part_type_id: fx.part_type_id, part_type_code: fx.part_type_code, required_blade_count: fx.required_blade_count };
    await fs.writeFile(reportPath, JSON.stringify({ database: connection.database, suffix, checks, calls, completed: false, fixture, browserFixture, requestIds }, null, 2) + '\n');
    if (process.argv.includes('--browser')) {
      retainBrowserFixtures = true;
      await browserChecks(browserFixture.openRequest, browserFixture.readyRequest, access);
      retainBrowserFixtures = false;
    }
    else console.log('SKIP Browser checks (supply --browser with a running web server)');
    // Leave genuine test inventory/history intact. Close our remaining open demand only.
    for (const id of requestIds) {
      const current = await row(id);
      if (!['COMPLETED', 'CANCELED'].includes(current.stored_status || current.status)) await status(id, 'CANCELED');
    }
    const persisted = await Promise.all(requestIds.map(snapshot));
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify({ database: connection.database, suffix, checks, calls, completed: true, fixture, browserFixture, requestIds, persisted }, null, 2) + '\n');
    check(true, 'Refresh preserves request/history evidence; restart-verification report saved');
    console.log(`PASS Cutter Requests acceptance (${checks} checks, ${calls} API calls). Restart API, then rerun with --verify-restart.`);
  }
} finally {
  for (const id of requestIds) {
    if (retainBrowserFixtures && [browserFixture?.openRequest.requestId, browserFixture?.readyRequest.requestId].includes(id)) continue;
    const current = await row(id).catch(() => null);
    if (current && !['COMPLETED', 'CANCELED'].includes(current.stored_status || current.status)) {
      await status(id, 'CANCELED').catch(() => {});
    }
  }
  for (const id of testAccounts) await api('PATCH', `/users/${id}`, { active: false }, [200]).catch(() => {});
  for (const id of roleIds) await api('PATCH', `/admin/access/roles/${id}`, { enabled: false }, [200]).catch(() => {});
  if (source.isInitialized) await source.destroy();
  await db.end();
}
