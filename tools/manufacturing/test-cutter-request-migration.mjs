import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

import { CUTTER_REQUESTS_MIGRATION } from '../../libs/manufacturing/server/data-access/src/lib/cutter-request.schema.ts';

if (
  process.env.MESHFORGE_ALLOW_TEST_ACCOUNTS !== 'YES' ||
  !/(test|cloud_dev)/i.test(process.env.DATABASE_NAME ?? '')
) {
  throw new Error(
    'Cutter Request migration checks require MESHFORGE_ALLOW_TEST_ACCOUNTS=YES and a disposable test/cloud_dev database configuration.',
  );
}
for (const key of ['DATABASE_HOST', 'DATABASE_USERNAME', 'DATABASE_PASSWORD']) {
  if (!process.env[key]) throw new Error(`Missing required database setting: ${key}`);
}

const databaseName = `meshforge_cutter_request_migration_test_${process.pid}_${randomBytes(4).toString('hex')}`;
assert.match(databaseName, /^meshforge_cutter_request_migration_test_\d+_[a-f0-9]+$/);
const quotedDatabase = `"${databaseName}"`;
const config = {
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
};
const admin = new pg.Client({ ...config, database: 'postgres' });
let client;
let created = false;
let checks = 0;

function same(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

async function snapshot() {
  const requests = await client.query(
    'SELECT to_jsonb(r) AS record FROM public.cutter_requests r ORDER BY id',
  );
  const history = await client.query(
    'SELECT to_jsonb(h) AS record FROM public.cutter_request_history h ORDER BY id',
  );
  return { requests: requests.rows, history: history.rows };
}

async function allocations() {
  return (
    await client.query(
      'SELECT to_jsonb(a) AS record FROM public.cutter_request_build_allocations a ORDER BY build_id',
    )
  ).rows;
}

async function partTypeForeignKeys() {
  return (
    await client.query(`
      SELECT c.conname, n.nspname || '.' || target.relname AS target
      FROM pg_constraint c
      JOIN pg_class target ON target.oid=c.confrelid
      JOIN pg_namespace n ON n.oid=target.relnamespace
      WHERE c.contype='f' AND c.conrelid='public.cutter_requests'::regclass
        AND c.conkey @> ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid=c.conrelid AND attname='part_type_id')]::smallint[]
      ORDER BY c.conname
    `)
  ).rows;
}

async function migrate() {
  await client.query('BEGIN');
  try {
    await client.query(CUTTER_REQUESTS_MIGRATION.sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedRequest(id, summaryId, partTypeId, notes = 'Preserve original request notes') {
  await client.query(
    `INSERT INTO public.cutter_requests
      (id,summary_id,part_type_id,requested_quantity,remaining_quantity,status,
       requested_by,updated_by,notes,requested_at,updated_at,completed_at)
     VALUES($1,$2,$3,3,2,'IN_PROGRESS','legacy team lead','legacy cutter grinder',$4,
       '2026-10-01 12:00:00+00','2026-10-01 13:00:00+00',NULL)`,
    [id, summaryId, partTypeId, notes],
  );
}

async function seedHistory(requestId, buildId, occurredAt) {
  await client.query(
    `INSERT INTO public.cutter_request_history
      (id,request_id,build_id,event_type,user_id,notes,quantity_delta,occurred_at)
     VALUES($1,$2,$3,'AUTO_FULFILLED','legacy builder','Historical build link',-1,$4)`,
    [randomUUID(), requestId, buildId, occurredAt],
  );
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);
  created = true;
  client = new pg.Client({ ...config, database: databaseName });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");

  // Only these synthetic master/build records exist in this isolated database.
  await client.query(`
    CREATE TABLE public.part_summaries(id uuid PRIMARY KEY);
    CREATE TABLE public.part_types(id uuid PRIMARY KEY);
    CREATE TABLE public.cutter_part_types(id uuid PRIMARY KEY);
    CREATE TABLE public.cutter_builds(id uuid PRIMARY KEY);
    CREATE TABLE public.cutter_requests(
      id uuid PRIMARY KEY, summary_id uuid, part_type_id uuid,
      requested_quantity integer, remaining_quantity integer, status text,
      requested_by text, updated_by text, notes text,
      requested_at timestamptz, updated_at timestamptz, completed_at timestamptz,
      CONSTRAINT historical_wrong_part_type_fk
        FOREIGN KEY(part_type_id) REFERENCES public.cutter_part_types(id)
    );
    CREATE TABLE public.cutter_request_history(
      id uuid PRIMARY KEY, request_id uuid, build_id uuid, event_type text,
      user_id text, notes text, quantity_delta integer, occurred_at timestamptz
    );
  `);

  const summaryId = randomUUID();
  const typeId = randomUUID();
  const buildId = randomUUID();
  const requestId = randomUUID();
  await client.query('INSERT INTO public.part_summaries(id) VALUES($1)', [summaryId]);
  await client.query('INSERT INTO public.part_types(id) VALUES($1)', [typeId]);
  await client.query('INSERT INTO public.cutter_part_types(id) VALUES($1)', [typeId]);
  await client.query('INSERT INTO public.cutter_builds(id) VALUES($1)', [buildId]);
  await seedRequest(requestId, summaryId, typeId, "Keep the original note's text\nand its line break.");
  // Preserve repeated historical events, but import one unique build claim.
  await seedHistory(requestId, buildId, '2026-10-01T12:10:00Z');
  await seedHistory(requestId, buildId, '2026-10-01T12:20:00Z');
  const original = await snapshot();
  const originalTables = (
    await client.query(`SELECT 'public.cutter_requests'::regclass::oid AS requests,
      'public.cutter_request_history'::regclass::oid AS history`)
  ).rows;

  await migrate();
  same(await snapshot(), original, 'Migration must preserve every old request/history field');
  same(
    (
      await client.query(`SELECT 'public.cutter_requests'::regclass::oid AS requests,
        'public.cutter_request_history'::regclass::oid AS history`)
    ).rows,
    originalTables,
    'Existing request/history tables must be reused rather than replaced',
  );
  same(
    (await partTypeForeignKeys()).map(row => row.target),
    ['public.part_types'],
    'The D2 foreign key must reference public.part_types, not cutter_part_types',
  );
  const firstAllocations = await allocations();
  same(firstAllocations.length, 1, 'Repeated old history must create only one build claim');
  same(
    firstAllocations[0].record,
    {
      build_id: buildId,
      request_id: requestId,
      fulfilled_at: '2026-10-01T12:10:00+00:00',
      reversed_at: null,
      legacy_conflict: false,
    },
    'The unique historical association and earliest fulfillment timestamp must survive',
  );
  same(
    (await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='cutter_requests' AND column_name='built_quantity'`))
      .rows,
    [],
    'Restoration must not invent a built_quantity column',
  );
  await migrate();
  same(await snapshot(), original, 'A second migration run must preserve original rows');
  same(await allocations(), firstAllocations, 'A second migration run must leave build claims stable');

  // Conflicting old links are retained and flagged; no request silently wins the build.
  const ambiguousBuildId = randomUUID();
  const requestTwo = randomUUID();
  const requestThree = randomUUID();
  await client.query('INSERT INTO public.cutter_builds(id) VALUES($1)', [ambiguousBuildId]);
  await seedRequest(requestTwo, summaryId, typeId, 'First surviving link');
  await seedRequest(requestThree, summaryId, typeId, 'Second surviving link');
  await seedHistory(requestTwo, ambiguousBuildId, '2026-10-01T14:00:00Z');
  await seedHistory(requestThree, ambiguousBuildId, '2026-10-01T14:05:00Z');
  const beforeAmbiguous = await snapshot();
  await migrate();
  same(await snapshot(), beforeAmbiguous, 'Ambiguous links and their requests must remain intact');
  const ambiguous = (await allocations()).find(row => row.record.build_id === ambiguousBuildId);
  same(
    { request_id: ambiguous.record.request_id, legacy_conflict: ambiguous.record.legacy_conflict },
    { request_id: null, legacy_conflict: true },
    'A build linked to multiple historical requests must be flagged without choosing an owner',
  );
  const afterAmbiguous = await allocations();
  await migrate();
  same(await allocations(), afterAmbiguous, 'Conflict flags must remain stable on restart');

  // An incompatible legacy shape must abort, not synthesize or coerce saved fields.
  await client.query(`ALTER TABLE public.cutter_requests ALTER COLUMN requested_quantity
    TYPE text USING requested_quantity::text`);
  const incompatibleRows = await snapshot();
  const incompatibleClaims = await allocations();
  await assert.rejects(migrate(), /incompatible cutter_requests\.requested_quantity/);
  checks++;
  same(await snapshot(), incompatibleRows, 'Rejected shape migration must leave legacy rows unchanged');
  same(await allocations(), incompatibleClaims, 'Rejected shape migration must leave claims unchanged');
  same(
    (await client.query(`SELECT udt_name FROM information_schema.columns WHERE table_schema='public'
      AND table_name='cutter_requests' AND column_name='requested_quantity'`)).rows[0].udt_name,
    'text',
    'An incompatible column must not be silently converted',
  );
  await client.query(`ALTER TABLE public.cutter_requests ALTER COLUMN requested_quantity
    TYPE integer USING requested_quantity::integer`);

  // A wrong-table ID absent from real part_types requires reconciliation, not remapping.
  for (const fk of await partTypeForeignKeys()) {
    assert.match(fk.conname, /^[a-z_]+$/);
    await client.query(`ALTER TABLE public.cutter_requests DROP CONSTRAINT "${fk.conname}"`);
  }
  await client.query(`ALTER TABLE public.cutter_requests ADD CONSTRAINT historical_wrong_part_type_fk
    FOREIGN KEY(part_type_id) REFERENCES public.cutter_part_types(id)`);
  const orphanTypeId = randomUUID();
  await client.query('INSERT INTO public.cutter_part_types(id) VALUES($1)', [orphanTypeId]);
  await seedRequest(randomUUID(), summaryId, orphanTypeId, 'Unresolved historical type: do not remap');
  const orphanRows = await snapshot();
  const orphanClaims = await allocations();
  const orphanKeys = await partTypeForeignKeys();
  await assert.rejects(migrate(), /legacy part_type_id values do not resolve/);
  checks++;
  same(await snapshot(), orphanRows, 'Unresolved historical type IDs and rows must be preserved');
  same(await allocations(), orphanClaims, 'Failed foreign-key repair must not change allocations');
  same(await partTypeForeignKeys(), orphanKeys, 'Failed foreign-key repair must retain the original FK');

  console.log(`PASS: ${checks} Cutter Request migration preservation checks in a separate disposable PostgreSQL database.`);
} finally {
  await client?.end();
  if (created) await admin.query(`DROP DATABASE ${quotedDatabase}`);
  await admin.end();
}
