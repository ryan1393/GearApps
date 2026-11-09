const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { databaseSource } = require('./runtime.cjs');
const {
  auditGearDatabase,
  compareOriginalProjection,
  runDatabaseMigration,
  SHARED_CORE_INTEGRITY_SQL,
} = require('@gearapps/shared/database');
const { migrateLapperPostgres } = require('../../libs/api/postgres/src/lib/schema.ts');
if (
  process.env.GEAR_APPS_ALLOW_TEST_ACCOUNTS !== 'YES' ||
  !process.env.DATABASE_NAME?.endsWith('_integrity_test')
)
  throw new Error(
    'Use a disposable *_integrity_test restore and GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES',
  );

test(
  'GearApps cleanup preserves source history and enforces database integrity',
  { timeout: 180000 },
  async (t) => {
    const source = databaseSource();
    await source.initialize();
    const q = (sql, params = []) => source.query(sql, params);
    const original = await q(`SELECT n.nspname AS schema,c.relname AS name,
    ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','lapper') AND c.relkind='r' ORDER BY 1,2`);
    const snapshot = async (reconstructed = false) => {
      const result = {};
      for (const table of original) {
        let name = table.name;
        if (
          reconstructed &&
          table.schema === 'lapper' &&
          ['machine_cycles', 'macro_logs'].includes(name)
        )
          name += '_with_legacy';
        result[table.schema + '.' + table.name] = await compareOriginalProjection(
          source.manager,
          table.schema,
          name,
          table.columns,
        );
      }
      return result;
    };
    const expectedError = async (sql, params, code) => {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await assert.rejects(
          async () => {
            await runner.query(sql, params);
            await runner.query('SET CONSTRAINTS ALL IMMEDIATE');
          },
          (error) => error.driverError?.code === code || error.code === code,
        );
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    };
    try {
      const [state] = await q("SELECT to_regclass('gearapps_meta.schema_migrations') AS installed");
      assert.equal(
        state.installed,
        null,
        'Restore an unmodified merged backup for this migration test',
      );
      const baseline = await snapshot();
      await t.test('conflicting duplicate snapshots abort the whole transaction', async () => {
        const [sample] = await q(
          'SELECT l.id AS log_id,c.id AS cycle_id FROM lapper.macro_logs l JOIN lapper.machine_cycles c ON c.id=l.machine_cycle_id LIMIT 1',
        );
        assert.ok(sample, 'Restore the supplied merged backup first');
        const cycleId = randomUUID(),
          logId = randomUUID();
        await q(
          `INSERT INTO lapper.machine_cycles SELECT(jsonb_populate_record(NULL::lapper.machine_cycles,to_jsonb(c)||jsonb_build_object('id',$1::uuid))).* FROM lapper.machine_cycles c WHERE c.id=$2`,
          [cycleId, sample.cycle_id],
        );
        await q(
          `INSERT INTO lapper.macro_logs SELECT(jsonb_populate_record(NULL::lapper.macro_logs,to_jsonb(l)||jsonb_build_object('id',$1::uuid,'machine_cycle_id',$2::uuid,'value',CASE WHEN l.value=0 THEN 1 ELSE 0 END))).* FROM lapper.macro_logs l WHERE l.id=$3`,
          [logId, cycleId, sample.log_id],
        );
        try {
          const withConflict = await snapshot();
          await assert.rejects(() => migrateLapperPostgres(source), /conflicting macro values/);
          assert.deepEqual(await snapshot(), withConflict);
          assert.equal(
            (await q("SELECT to_regclass('gearapps_meta.schema_migrations') AS installed"))[0]
              .installed,
            null,
          );
        } finally {
          await q('DELETE FROM lapper.macro_logs WHERE id=$1', [logId]);
          await q('DELETE FROM lapper.machine_cycles WHERE id=$1', [cycleId]);
        }
        assert.deepEqual(await snapshot(), baseline);
      });
      await t.test('cleanup and concurrent replay preserve every original field', async () => {
        await migrateLapperPostgres(source);
        assert.deepEqual(await snapshot(true), baseline);
        const before = await auditGearDatabase(source);
        await Promise.all([migrateLapperPostgres(source), migrateLapperPostgres(source)]);
        assert.deepEqual(await snapshot(true), baseline);
        assert.deepEqual(await auditGearDatabase(source), before);
        assert.equal(before.foreignKeyViolations.length, 0);
        assert.ok(before.checks.filter((c) => c.severity === 'error').every((c) => c.count === 0));
        console.log(
          'Preserved ' +
            original.length +
            ' original tables and ' +
            Object.values(baseline).reduce((sum, v) => sum + v.rows, 0) +
            ' original rows through canonical data and archives.',
        );
      });
      await t.test('duplicate cycles and macro snapshots are rejected by PostgreSQL', async () => {
        const [{ id: cycleId }] = await q('SELECT id FROM lapper.machine_cycles LIMIT 1');
        await expectedError(
          `INSERT INTO lapper.machine_cycles SELECT(jsonb_populate_record(NULL::lapper.machine_cycles,to_jsonb(c)||jsonb_build_object('id',$1::uuid))).* FROM lapper.machine_cycles c WHERE id=$2`,
          [randomUUID(), cycleId],
          '23505',
        );
        const [{ id: macroId }] = await q('SELECT id FROM lapper.macro_logs LIMIT 1');
        await expectedError(
          `INSERT INTO lapper.macro_logs SELECT(jsonb_populate_record(NULL::lapper.macro_logs,to_jsonb(l)||jsonb_build_object('id',$1::uuid))).* FROM lapper.macro_logs l WHERE id=$2`,
          [randomUUID(), macroId],
          '23505',
        );
        await expectedError(
          'UPDATE lapper.macro_logs SET value=$1 WHERE id=$2',
          ['NaN', macroId],
          '23514',
        );
      });
      await t.test('normalized identities and new foreign keys are enforced', async () => {
        const parts = await q('SELECT id,part_number FROM public.parts LIMIT 2');
        assert.equal(parts.length, 2);
        await expectedError(
          'UPDATE public.parts SET part_number=$1 WHERE id=$2',
          [' ' + parts[1].part_number + ' ', parts[0].id],
          '23505',
        );
        const [{ id: build }] = await q('SELECT id FROM public.cutter_builds LIMIT 1');
        await expectedError(
          'UPDATE public.cutter_builds SET cutter_builder_machine_id=$1 WHERE id=$2',
          [randomUUID(), build],
          '23503',
        );
      });
      await t.test('component-role checks cover both assemblies and shared parts', async () => {
        const [gear] = await q(
          'SELECT id,gearset_part_id,ring_part_id,summary_id FROM public.gearsets LIMIT 1',
        );
        const [{ id: pinionType }] = await q(
          "SELECT id FROM public.part_types WHERE code='PINION'",
        );
        await expectedError(
          'UPDATE public.gearsets SET ring_part_id=pinion_part_id WHERE id=$1',
          [gear.id],
          '23514',
        );
        await expectedError(
          'UPDATE public.parts SET part_type_id=$1 WHERE id=$2',
          [pinionType, gear.ring_part_id],
          '23514',
        );
        const [{ id: otherSummary }] = await q(
          'SELECT id FROM public.part_summaries WHERE id<>$1 LIMIT 1',
          [gear.summary_id],
        );
        await expectedError(
          'UPDATE public.parts SET summary_id=$1 WHERE id=$2',
          [otherSummary, gear.gearset_part_id],
          '23514',
        );
        const runner = source.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
          await runner.query('UPDATE public.parts SET summary_id=$1 WHERE id=$2', [
            otherSummary,
            gear.gearset_part_id,
          ]);
          await runner.query('UPDATE public.gearsets SET summary_id=$1 WHERE id=$2', [
            otherSummary,
            gear.id,
          ]);
          await runner.query('SET CONSTRAINTS ALL IMMEDIATE');
        } finally {
          await runner.rollbackTransaction();
          await runner.release();
        }
        assert.deepEqual(await snapshot(true), baseline);
      });
      await t.test('original archives cannot be changed or deleted', async () => {
        const [{ id }] = await q('SELECT id FROM lapper.machine_cycle_archive LIMIT 1');
        await expectedError(
          'UPDATE lapper.machine_cycle_archive SET canonical_id=canonical_id WHERE id=$1',
          [id],
          '23514',
        );
        await expectedError('DELETE FROM lapper.machine_cycle_archive WHERE id=$1', [id], '23514');
      });
      await t.test(
        'migration checksums survive CRLF but reject changed migration text',
        async () => {
          await source.transaction((manager) =>
            runDatabaseMigration(
              manager,
              '20261109-shared-core-integrity-v1',
              SHARED_CORE_INTEGRITY_SQL.replace(/\n/g, '\r\n'),
            ),
          );
          await assert.rejects(
            () =>
              source.transaction((manager) =>
                runDatabaseMigration(
                  manager,
                  '20261109-shared-core-integrity-v1',
                  SHARED_CORE_INTEGRITY_SQL + '\nSELECT 1;',
                ),
              ),
            /checksum differs/,
          );
          assert.deepEqual(await snapshot(true), baseline);
        },
      );
    } finally {
      await source.destroy();
    }
  },
);
