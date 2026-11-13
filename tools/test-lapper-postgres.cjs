/* Run only against a disposable copy of MeshForge, never the production DB.
 * MESHFORGE_ALLOW_TEST_ACCOUNTS=YES DATABASE_NAME=..._lapper_test
 * DATABASE_HOST/PORT/USERNAME/PASSWORD must point at that restored copy.
 */
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');

if (
  process.env.MESHFORGE_ALLOW_TEST_ACCOUNTS !== 'YES' ||
  !process.env.DATABASE_NAME?.endsWith('_lapper_test')
) {
  throw new Error('Use a disposable *_lapper_test database and MESHFORGE_ALLOW_TEST_ACCOUNTS=YES');
}
Object.assign(process.env, {
  DATABASE_TYPE: 'postgres',
  DATABASE_SYNCHRONIZE: 'false',
  DATABASE_LOGGING_ENABLED: 'false',
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  JWT_REFRESH_SECRET: randomBytes(48).toString('base64url'),
  EMAIL_ENABLED: 'false',
  SOCIAL_GOOGLE_ENABLED: 'false',
  ENVIRONMENT: 'test',
  SWAGGER_ENABLED: 'false',
  TS_NODE_PROJECT: path.resolve(__dirname, '../apps/server/tsconfig.app.json'),
  TS_NODE_BASEURL: path.resolve(__dirname, '..'),
  TS_NODE_TRANSPILE_ONLY: '1',
});
require('reflect-metadata');
require('ts-node/register');
require('tsconfig-paths/register');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const bcrypt = require('bcrypt');
const { AppModule } = require('../apps/server/src/app/app.module');
const { configureApi } = require('../apps/server/src/configure-api');
const { migrateLapperPostgres } = require('../libs/api/postgres/src/lib/schema');

test('Lapper uses the shared MeshForge PostgreSQL database', { timeout: 180000 }, async (t) => {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configureApi(app);
  await app.init();
  const db = app.get(DataSource);
  const query = (sql, parameters = []) => db.query(sql, parameters);
  const fixtures = {
    users: [],
    gears: [],
    parts: [],
    summaries: [],
    machines: [],
    departments: [],
  };
  let base, scannerBefore;
  const fingerprintColumns = new Map();
  const fingerprints = async () => {
    const tables = await query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const result = {};
    for (const { tablename } of tables) {
      assert.match(tablename, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
      if (!fingerprintColumns.has(tablename)) {
        const columns = await query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [tablename],
        );
        fingerprintColumns.set(
          tablename,
          columns.map((c) => '"' + c.column_name.replaceAll('"', '""') + '"').join(','),
        );
      }
      const [row] = await query(
        `SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM (SELECT ${fingerprintColumns.get(tablename)} FROM public."${tablename}") t`,
      );
      result[tablename] = row;
    }
    return result;
  };
  const before = await fingerprints();
  const request = async (method, route, body, token, expected = 200, key) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${route}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : undefined;
  };
  try {
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/api/v1/';
    await migrateLapperPostgres(db); // A second startup must be harmless.
    const password = randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);
    for (const role of ['admin', 'user']) {
      const id = randomUUID(),
        username = 'lapper-test-' + role + '-' + id;
      fixtures.users.push({ id, username, role });
      await query(
        `INSERT INTO public.users(id,username,email,password,"firstName","lastName",role,active)
        VALUES($1,$2,$3,$4,'Lapper','Integration',$5,true)`,
        [id, username, username + '@example.invalid', passwordHash, role],
      );
    }
    const admin = (
      await request('POST', 'auth/email/login', {
        email: fixtures.users[0].username + '@example.invalid',
        password,
      })
    ).accessToken;
    let operator = (
      await request('POST', 'auth/email/login', {
        email: fixtures.users[1].username + '@example.invalid',
        password,
      })
    ).accessToken;
    // Machine data comes from collector tokens (Lapper Read) or administrators, never user accounts.
    const collector = (
      await request('POST', 'collector-token', { name: 'Lapper integration test' }, admin, 201)
    ).token;
    await t.test('shared login, closed registration and token purpose', async () => {
      // Capabilities also report whether password reset is on (it follows EMAIL_ENABLED).
      const capabilities = await request('GET', 'auth/capabilities');
      assert.equal(capabilities.registrationEnabled, false);
      assert.equal(typeof capabilities.passwordResetEnabled, 'boolean');
      await request(
        'POST',
        'users',
        { email: 'lapper-test@example.invalid', password, fname: 'Test', lname: 'Test' },
        undefined,
        401,
      );
      await request('PATCH', `users/${fixtures.users[1].id}`, { fname: 'Changed' }, operator, 403);
      const me = await request('GET', 'auth/me', undefined, operator);
      assert.equal(me.id, fixtures.users[1].id);
      assert.equal(me.password, undefined);
      assert.equal(me.refreshToken, undefined);
      const otherToken = new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign({
        sub: fixtures.users[1].id,
      });
      await request('GET', 'machine', undefined, otherToken, 401);
      await query('UPDATE public.users SET active=false WHERE id=$1', [fixtures.users[1].id]);
      await request('GET', 'machine', undefined, operator, 401);
      await request('GET', 'auth/me', undefined, operator, 401);
      await request(
        'POST',
        'auth/email/login',
        { email: fixtures.users[1].username + '@example.invalid', password },
        undefined,
        403,
      );
      await query('UPDATE public.users SET active=true WHERE id=$1', [fixtures.users[1].id]);
      await query('UPDATE public.users SET "authVersion"="authVersion"+1 WHERE id=$1', [
        fixtures.users[1].id,
      ]);
      await request('GET', 'machine', undefined, operator, 401);
      operator = (
        await request('POST', 'auth/email/login', {
          email: fixtures.users[1].username + '@example.invalid',
          password,
        })
      ).accessToken;
    });
    await t.test('one API owns authentication, users and all application routes', async () => {
      await request('GET', 'machine', undefined, undefined, 401);
      await request('GET', 'admin/master-data/departments', undefined, admin);
      await request('GET', 'admin/master-data/departments', undefined, operator, 403);
      await request('GET', 'auth/me', undefined, operator);
      await request('GET', 'health/ready');
      const [greenshedDepartment] = await query(
        "SELECT id FROM public.departments WHERE code='48' AND active AND enabled LIMIT 1",
      );
      assert.ok(greenshedDepartment, 'Restored MeshForge has the Greenshed department');
      await query('UPDATE public.users SET "departmentId"=$1 WHERE id=$2', [
        greenshedDepartment.id,
        fixtures.users[1].id,
      ]);
      // An editor must reach the manufacturing DTO validator. A Lapper-wide
      // setup interceptor would incorrectly deny this POST before validation.
      await request('POST', 'greenshed/setup', {}, operator, 422);
      assert.equal(db.options.type, 'postgres');
      assert.ok(
        !db.entityMetadatas.some((m) => m.tableName === 'Machine_Cycles'),
        'Legacy repositories must not enter the shared connection',
      );
      await request(
        'POST',
        'auth/login',
        { email: fixtures.users[1].username + '@example.invalid', password },
        undefined,
        404,
      );
      const router = app.getHttpAdapter().getInstance().router;
      const endpoints = router.stack
        .filter((s) => s.route)
        .flatMap((s) => Object.keys(s.route.methods).map((m) => m + ' ' + s.route.path));
      assert.equal(
        new Set(endpoints).size,
        endpoints.length,
        'Duplicate controller routes must not depend on registration order',
      );
      const refreshed = await request(
        'GET',
        'auth/refresh',
        undefined,
        (
          await request('POST', 'auth/email/login', {
            email: fixtures.users[1].username + '@example.invalid',
            password,
          })
        ).refreshToken,
      );
      await request('GET', 'machine', undefined, refreshed.accessToken);
      await request('GET', 'admin/master-data/departments', undefined, refreshed.accessToken, 403);
    });
    const machines = await request('GET', 'machine', undefined, operator);
    const gears = await request('GET', 'gearset', undefined, operator);
    const macros = await request('GET', 'macro', undefined, operator);
    await t.test('shared catalog and imported history', async () => {
      const [counts] = await query(
        'SELECT (SELECT count(*) FROM lapper.machines)::int AS machines,(SELECT count(*) FROM lapper.macros)::int AS macros',
      );
      assert.equal(machines.length, counts.machines);
      assert.equal(macros.length, counts.macros);
      const [cycleAlias] = await query(
        'SELECT original_id,canonical_id FROM lapper.machine_cycle_aliases LIMIT 1',
      );
      if (cycleAlias)
        assert.equal(
          (await request('GET', `machine-cycle/${cycleAlias.original_id}`, undefined, operator)).id,
          cycleAlias.canonical_id,
        );
      const [macroAlias] = await query(
        'SELECT original_id,canonical_id FROM lapper.macro_log_aliases LIMIT 1',
      );
      if (macroAlias)
        assert.equal(
          (await request('GET', `macro-log/${macroAlias.original_id}`, undefined, operator)).id,
          macroAlias.canonical_id,
        );
      const canonical = await query('SELECT id FROM public.gearsets');
      assert.ok(canonical.every((g) => gears.some((api) => api.id === g.id)));
      const [sample] = await query(`SELECT c.*,m.public_machine_id,g.public_gearset_id,
        c.timestamp AT TIME ZONE 'America/Indianapolis' AS expected_time FROM lapper.machine_cycles c
        JOIN lapper.machines m ON m.id=c.machine_id JOIN lapper.gearsets g ON g.id=c.gearset_id
        WHERE g.public_gearset_id IS NOT NULL ORDER BY c.timestamp DESC LIMIT 1`);
      if (sample) {
        const cycle = await request('GET', `machine-cycle/${sample.id}`, undefined, operator);
        assert.equal(cycle.machine_id, sample.public_machine_id);
        assert.equal(cycle.gearset_id, sample.public_gearset_id);
        assert.equal(
          new Date(cycle.timestamp).toISOString(),
          new Date(sample.expected_time).toISOString(),
        );
        const summary = await request(
          'GET',
          `macro-log/summary/${cycle.machine_id}/${cycle.gearset_id}`,
          undefined,
          operator,
        );
        const [{ count }] = await query(
          `SELECT count(DISTINCT l.macro_id)::int AS count FROM lapper.macro_logs l
          JOIN lapper.machine_cycles c ON c.id=l.machine_cycle_id JOIN lapper.gearsets g ON g.id=c.gearset_id
          JOIN lapper.machines m ON m.id=c.machine_id WHERE m.public_machine_id=$1 AND g.public_gearset_id=$2`,
          [cycle.machine_id, cycle.gearset_id],
        );
        assert.equal(summary.length, count);
        assert.ok(summary.every((r) => typeof r.value === 'number'));
      }
      const duplicates = await query(
        'SELECT machine_ip FROM lapper.machines GROUP BY machine_ip HAVING count(*)>1',
      );
      for (const { machine_ip: ip } of duplicates) {
        await request('GET', 'machine/ip/' + encodeURIComponent(ip), undefined, operator, 409);
        for (const m of machines.filter((m) => m.ip === ip)) {
          assert.equal(
            (
              await request(
                'GET',
                `machine/ip/${encodeURIComponent(ip)}?number=${encodeURIComponent(m.number)}`,
                undefined,
                operator,
              )
            ).id,
            m.id,
          );
        }
      }
    });
    await t.test('administrator master data uses the shared public tables', async () => {
      const number = 'LAPPER-TEST-' + randomUUID().slice(0, 8);
      const [model] = await query(
        'SELECT model_number FROM public.models WHERE "deletedAt" IS NULL AND model_number IS NOT NULL LIMIT 1',
      );
      assert.ok(model);
      const department = await request(
        'POST',
        'department',
        { number: 999991, description: number },
        admin,
        201,
      );
      fixtures.departments.push(department.id);
      const machine = await request(
        'POST',
        'machine',
        { number, ip: '127.0.0.31', dept_id: '999991', cell: '2', status: 'Active' },
        admin,
        201,
      );
      fixtures.machines.push(machine.id);
      const [sharedMachine] = await query(
        'SELECT machine_number,cell FROM public.machines WHERE id=$1',
        [machine.id],
      );
      assert.equal(sharedMachine.machine_number, number);
      assert.equal(sharedMachine.cell, 2);
      const updated = await request(
        'PATCH',
        `machine/${machine.id}`,
        { description: 'Test machine', cell: '3' },
        admin,
      );
      assert.equal(updated.cell, '3');
      await request(
        'PUT',
        `machine/${machine.id}`,
        {
          ...{
            id: machine.id,
            number: number + '-moved',
            ip: '127.0.0.31',
            dept_id: '999991',
            cell: '3',
            status: 'Active',
          },
        },
        admin,
        409,
      );
      const summary = await request(
        'POST',
        'part-summary',
        {
          number,
          model: String(model.model_number),
          hos: 'TEST',
          status: 'Active',
          user_id: fixtures.users[1].id,
        },
        admin,
        201,
      );
      fixtures.summaries.push(summary.id);
      const part = await request(
        'POST',
        'part',
        {
          number: number + '-R',
          type: 'Ring',
          summary_id: summary.id,
          teeth: 42,
          status: 'Active',
          user_id: fixtures.users[1].id,
        },
        admin,
        201,
      );
      fixtures.parts.push(part.id);
      const [sharedPart] = await query(
        'SELECT summary_id,teeth,"createdBy" FROM public.parts WHERE id=$1',
        [part.id],
      );
      assert.equal(sharedPart.summary_id, summary.id);
      assert.equal(sharedPart.teeth, 42);
      assert.equal(sharedPart.createdBy, fixtures.users[0].id);
      const changed = await request(
        'PATCH',
        `part/${part.id}`,
        { teeth: 43, status: 'Inactive', user_id: fixtures.users[0].id },
        admin,
      );
      assert.equal(changed.teeth, 43);
      assert.equal(changed.status.toLowerCase(), 'inactive');
      const revisionId = randomUUID();
      await query(
        `INSERT INTO public.part_summaries(id,number,revision,model_id,hos,active,enabled)
        SELECT $1,number,'B',model_id,hos,true,true FROM public.part_summaries WHERE id=$2`,
        [revisionId, summary.id],
      );
      fixtures.summaries.push(revisionId);
      const ring = await request(
        'POST',
        'part',
        {
          number: number + '-R2',
          type: 'Ring',
          summary_id: summary.id,
          teeth: 40,
          status: 'Active',
          user_id: fixtures.users[0].id,
        },
        admin,
        201,
      );
      const pinion = await request(
        'POST',
        'part',
        {
          number: number + '-P',
          type: 'Pinion',
          summary_id: revisionId,
          teeth: 10,
          status: 'Active',
          user_id: fixtures.users[0].id,
        },
        admin,
        201,
      );
      fixtures.parts.push(ring.id, pinion.id);
      const assembly = await request(
        'POST',
        'gearset',
        {
          number: number + '-GS',
          ring_id: ring.id,
          pinion_id: pinion.id,
          summary_id: summary.id,
          status: 'Active',
          user_id: fixtures.users[0].id,
        },
        admin,
        201,
      );
      fixtures.gears.push(assembly.id);
      const [{ gearset_part_id: assemblyPart }] = await query(
        'SELECT gearset_part_id FROM public.gearsets WHERE id=$1',
        [assembly.id],
      );
      fixtures.parts.push(assemblyPart);
      assert.equal(assembly.summary_id, summary.id);
      assert.equal(assembly.pinion.summary_id, revisionId);
      assert.equal(assembly.ratio, 4);
    });
    await t.test(
      'collector writes decimal values and deduplicates concurrent retries',
      async () => {
        assert.ok(
          machines.length && gears.length && macros.length,
          'Restore a merged backup with Lapper data',
        );
        const body = {
          machine_id: machines[0].id,
          gearset_id: gears[0].id,
          serial_number: 'LAPPER-INTEGRATION',
          consec: 77,
          timestamp: '2026-11-09T18:42:13.123Z',
        };
        const key = randomUUID();
        const [first, second] = await Promise.all([
          request('POST', 'machine-cycle', body, collector, 201, key),
          request('POST', 'machine-cycle', body, collector, 201, key),
        ]);
        await request('POST', 'machine-cycle', body, operator, 403, randomUUID());
        assert.equal(first.id, second.id);
        assert.equal(
          (await request('POST', 'machine-cycle', body, collector, 201, randomUUID())).id,
          first.id,
        );
        assert.equal(first.timestamp, body.timestamp);
        // The write response reads only what it needs; it must match the full lists.
        assert.deepEqual(first.gearset, gears.find((g) => g.id === first.gearset_id));
        assert.deepEqual(first.machine, machines.find((m) => m.id === first.machine_id));
        const page = await request('GET', 'machine-cycle?page=1&pageSize=5', undefined, operator);
        assert.ok(Array.isArray(page) && page.length <= 5);
        assert.ok((await request('GET', 'machine-cycle', undefined, operator)).length <= 1000);
        assert.ok((await request('GET', 'macro-log?pageSize=3', undefined, operator)).length <= 3);
        await request('POST', 'machine-cycle', { ...body, consec: 78 }, collector, 409, key);
        const logBody = { machine_cycle_id: first.id, macro_id: macros[0].id, value: -12.34567 };
        const logKey = randomUUID();
        await request('POST', 'macro-log', logBody, operator, 403, randomUUID());
        const log = await request('POST', 'macro-log', logBody, collector, 201, logKey);
        assert.equal(log.value, logBody.value);
        assert.equal(
          (await request('POST', 'macro-log', logBody, collector, 201, randomUUID())).id,
          log.id,
        );
        await request('POST', 'macro-log', { ...logBody, value: 77 }, collector, 409, randomUUID());
        assert.equal(
          (await request('POST', 'macro-log', logBody, collector, 201, logKey)).id,
          log.id,
        );
        const [persisted] = await query(
          'SELECT value::text AS value FROM lapper.macro_logs WHERE id=$1',
          [log.id],
        );
        assert.equal(persisted.value, '-12.34567');
        await request('POST', 'macro-log', { ...logBody, extra: true }, collector, 422);
        // Beyond numeric(13,5): rejected before the database, never a 500.
        await request('POST', 'macro-log', { ...logBody, value: 1e8 }, collector, 422, randomUUID());
        await request(
          'POST',
          'department',
          { number: 999999, description: 'Not allowed' },
          operator,
          403,
        );
        await request('DELETE', `machine-cycle/${first.id}`, undefined, admin, 409);
      },
    );
    await t.test('collector scanner telemetry preserves setup and machine signals', async () => {
      const scanners = await request('GET', 'scanner-detail', undefined, operator);
      if (scanners.length) {
        scannerBefore = scanners[0];
        const scanner = await request(
          'PATCH',
          `scanner-detail/${scannerBefore.id}/serial-numbers`,
          { sn_procces: 'PROCESS', sn_queue: null, sn_scanner: 'SCANNED' },
          collector,
        );
        await request(
          'PATCH',
          `scanner-detail/${scannerBefore.id}/serial-numbers`,
          { sn_procces: 'PROCESS', sn_queue: null, sn_scanner: 'SCANNED' },
          operator,
          403,
        );
        // The matched route decides, not the URL text.
        await request(
          'PATCH',
          `scanner-detail/${scannerBefore.id}?x=/serial-number/`,
          { ip: '127.0.0.1' },
          operator,
          403,
        );
        assert.equal(scanner.machine_id, scannerBefore.machine_id);
        assert.equal(scanner.ip, scannerBefore.ip);
        await request(
          'PATCH',
          `scanner-detail/${scannerBefore.id}`,
          { ip: '127.0.0.1' },
          operator,
          403,
        );
      }
      const machine = machines.find((m) => m.id !== scannerBefore?.machine_id) ?? machines[0];
      const snapshotBody = {
        machine_id: machine.id,
        x06_7_frt_dr_closed: false,
        x01_2_start_cycle: true,
        y03_2_stack_inCycle: false,
      };
      const [a, b] = await Promise.all([
        request('POST', 'machine-fanuc-variable', snapshotBody, collector, 201),
        request('POST', 'machine-fanuc-variable', snapshotBody, collector, 201),
      ]);
      await request('POST', 'machine-fanuc-variable', snapshotBody, operator, 403);
      assert.equal(a.id, b.id);
      const snapshot = await request(
        'PATCH',
        `machine-fanuc-variable/${a.id}`,
        { x01_2_start_cycle: true, y03_2_stack_inCycle: false },
        collector,
      );
      await request(
        'PATCH',
        `machine-fanuc-variable/${a.id}`,
        { x01_2_start_cycle: true, y03_2_stack_inCycle: false },
        operator,
        403,
      );
      assert.equal(snapshot.x01_2_start_cycle, true);
      assert.equal(snapshot.y03_2_stack_inCycle, false);
    });
    await t.test(
      'new gearset assemblies share canonical parts and retain pending history',
      async () => {
        const pairs =
          await query(`SELECT r.id AS ring,p.id AS pinion,r.summary_id,r.teeth AS ring_teeth,p.teeth AS pinion_teeth
        FROM public.parts r JOIN public.part_types rt ON rt.id=r.part_type_id
        JOIN public.parts p ON p.summary_id=r.summary_id JOIN public.part_types pt ON pt.id=p.part_type_id
        WHERE rt.code='RING' AND pt.code='PINION' AND r.active AND r.enabled AND p.active AND p.enabled
        AND r."deletedAt" IS NULL AND p."deletedAt" IS NULL AND r.teeth>0 AND p.teeth>0 LIMIT 1`);
        assert.ok(pairs.length);
        const pair = pairs[0],
          number = 'LAPPER-TEST-' + randomUUID();
        await request(
          'POST',
          'gearset',
          {
            number,
            ring_id: pair.ring,
            pinion_id: pair.pinion,
            summary_id: pair.summary_id,
            status: 'Active',
          },
          operator,
          403,
        );
        await request('POST', 'gearset', { number, status: 'Active' }, operator, 403);
        const pending = await request(
          'POST',
          'gearset',
          { number, status: 'Active' },
          collector,
          201,
        );
        const pendingCycle = await request(
          'POST',
          'machine-cycle',
          {
            machine_id: machines[0].id,
            gearset_id: pending.id,
            serial_number: 'PENDING-TEST',
            consec: 78,
            timestamp: '2026-11-09T18:45:00Z',
          },
          collector,
          201,
          randomUUID(),
        );
        const assembly = await request(
          'POST',
          'gearset',
          {
            number,
            ring_id: pair.ring,
            pinion_id: pair.pinion,
            summary_id: pair.summary_id,
            status: 'Active',
            user_id: fixtures.users[0].id,
          },
          admin,
          201,
        );
        fixtures.gears.push(assembly.id);
        const [shared] = await query('SELECT * FROM public.gearsets WHERE id=$1', [assembly.id]);
        fixtures.parts.push(shared.gearset_part_id);
        assert.equal(shared.ring_part_id, pair.ring);
        assert.equal(shared.pinion_part_id, pair.pinion);
        assert.equal(assembly.ratio, Number((pair.ring_teeth / pair.pinion_teeth).toFixed(4)));
        // MeshForge may complete an assembly independently of this API.
        await query('UPDATE lapper.gearsets SET public_gearset_id=NULL WHERE id=$1', [pending.id]);
        assert.equal(
          (await request('GET', `gearset/${pending.id}`, undefined, operator)).id,
          assembly.id,
        );
        const history = await request(
          'GET',
          `machine-cycle/gearset/${assembly.id}`,
          undefined,
          operator,
        );
        assert.ok(history.some((c) => c.id === pendingCycle.id && c.gearset_id === assembly.id));
        const parts = await request('GET', 'part', undefined, operator);
        assert.ok(parts.some((p) => p.id === shared.gearset_part_id && p.type === 'Gearset'));
        // Reusing a renamed assembly's old number must never steal its history.
        await query('UPDATE public.parts SET part_number=$1 WHERE id=$2', [
          number + '-RENAMED',
          shared.gearset_part_id,
        ]);
        await query('UPDATE lapper.gearsets SET public_gearset_id=$1 WHERE id=$2', [
          assembly.id,
          pending.id,
        ]);
        const replacementPart = randomUUID(),
          replacementGear = randomUUID();
        await query(
          `INSERT INTO public.parts(id,part_number,summary_id,part_type_id,teeth,active,enabled)
          SELECT $1,$2,summary_id,part_type_id,teeth,active,enabled FROM public.parts WHERE id=$3`,
          [replacementPart, number, shared.gearset_part_id],
        );
        fixtures.parts.push(replacementPart);
        await query(
          `INSERT INTO public.gearsets(id,gearset_part_id,ring_part_id,pinion_part_id,summary_id,ratio_value,ratio_text)
          SELECT $1,$2,ring_part_id,pinion_part_id,summary_id,ratio_value,ratio_text FROM public.gearsets WHERE id=$3`,
          [replacementGear, replacementPart, assembly.id],
        );
        fixtures.gears.push(replacementGear);
        const replacementCycle = await request(
          'POST',
          'machine-cycle',
          {
            machine_id: machines[0].id,
            gearset_id: replacementGear,
            serial_number: 'REUSED-NUMBER-TEST',
            consec: 79,
            timestamp: '2026-11-09T18:46:00Z',
          },
          collector,
          201,
          randomUUID(),
        );
        assert.equal(replacementCycle.gearset_id, replacementGear);
        assert.equal(
          (await request('GET', `machine-cycle/${pendingCycle.id}`, undefined, operator))
            .gearset_id,
          assembly.id,
        );
        await request('DELETE', `part/${shared.gearset_part_id}`, undefined, admin, 409);
        await request('DELETE', `gearset/${assembly.id}`, undefined, admin, 409);
      },
    );
  } finally {
    if (scannerBefore)
      await query(
        'UPDATE lapper.scanners SET sn_procces=$1,sn_queue=$2,sn_scanner=$3 WHERE id=$4',
        [
          scannerBefore.sn_procces,
          scannerBefore.sn_queue,
          scannerBefore.sn_scanner,
          scannerBefore.id,
        ],
      );
    // Remove public fixtures; production rows must remain byte-for-byte equivalent.
    for (const id of fixtures.gears) {
      await query(
        'UPDATE lapper.gearsets SET public_gearset_id=NULL,user_id=NULL WHERE public_gearset_id=$1',
        [id],
      );
      await query('DELETE FROM public.gearsets WHERE id=$1', [id]);
    }
    for (const id of fixtures.parts) await query('DELETE FROM public.parts WHERE id=$1', [id]);
    for (const id of fixtures.summaries)
      await query('DELETE FROM public.part_summaries WHERE id=$1', [id]);
    for (const id of fixtures.machines) {
      await query('DELETE FROM lapper.machines WHERE public_machine_id=$1', [id]);
      await query('DELETE FROM public.machines WHERE id=$1', [id]);
    }
    for (const id of fixtures.departments)
      await query('DELETE FROM public.departments WHERE id=$1', [id]);
    for (const { id } of fixtures.users) {
      await query('DELETE FROM lapper.collector_tokens WHERE created_by=$1', [id]);
      await query('UPDATE lapper.gearsets SET user_id=NULL WHERE user_id=$1', [id]);
      await query('DELETE FROM public.users WHERE id=$1', [id]);
    }
    const after = await fingerprints();
    await app.close();
    assert.deepEqual(
      after,
      before,
      'Lapper startup, reads and collector writes must preserve all existing public MeshForge data',
    );
  }
});
