import { DataSource, EntityManager } from 'typeorm';

type Row = Record<string, unknown>;
type ForeignKey = {
  schema: string;
  table: string;
  name: string;
  validated: boolean;
  ref_schema: string;
  ref_table: string;
  columns: string[];
  ref_columns: string[];
};
export type DatabaseAuditCheck = {
  name: string;
  severity: 'error' | 'review' | 'info';
  count: number;
};
export type DatabaseAuditReport = {
  status: 'passed' | 'passed_with_review_items' | 'failed';
  tables: number;
  rowCounts: Record<string, number>;
  foreignKeysChecked: number;
  foreignKeyViolations: Array<{ table: string; constraint: string; count: number }>;
  checks: DatabaseAuditCheck[];
  migrations: string[];
};
const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';

/** Audits base tables, never views, in one read-only consistent snapshot. No row contents or credentials are returned. */
export async function auditGearDatabase(source: DataSource): Promise<DatabaseAuditReport> {
  return source.transaction('REPEATABLE READ', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    await manager.query("SET LOCAL statement_timeout='30s'");
    const tables = await manager.query<
      Array<{ schema: string; name: string; oid: number; has_pk: boolean }>
    >(`
      SELECT n.nspname AS schema,c.relname AS name,c.oid::int AS oid,
        EXISTS(SELECT 1 FROM pg_constraint p WHERE p.conrelid=c.oid AND p.contype='p') AS has_pk
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','lapper','gearapps_meta') AND c.relkind IN ('r','p') ORDER BY 1,2`);
    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      const [{ count }] = await manager.query<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${identifier(table.schema)}.${identifier(table.name)}`,
      );
      rowCounts[table.schema + '.' + table.name] = count;
    }
    const foreignKeys = await manager.query<ForeignKey[]>(`
      SELECT n.nspname AS schema,t.relname AS table,c.conname AS name,c.convalidated AS validated,
        rn.nspname AS ref_schema,rt.relname AS ref_table,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
          JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS ref_columns
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_class rt ON rt.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=rt.relnamespace
      WHERE c.contype='f' AND n.nspname IN ('public','lapper','gearapps_meta') ORDER BY 1,2,3`);
    const foreignKeyViolations: DatabaseAuditReport['foreignKeyViolations'] = [];
    for (const key of foreignKeys) {
      const nonnull = key.columns.map((c) => 'r.' + identifier(c) + ' IS NOT NULL').join(' AND ');
      const match = key.columns
        .map((c, i) => 'r.' + identifier(c) + '=p.' + identifier(key.ref_columns[i]))
        .join(' AND ');
      const [{ count }] = await manager.query<
        Array<{ count: number }>
      >(`SELECT count(*)::int AS count
        FROM ${identifier(key.schema)}.${identifier(key.table)} r WHERE ${nonnull} AND NOT EXISTS(
          SELECT 1 FROM ${identifier(key.ref_schema)}.${identifier(key.ref_table)} p WHERE ${match})`);
      if (count || !key.validated)
        foreignKeyViolations.push({
          table: key.schema + '.' + key.table,
          constraint: key.name,
          count,
        });
    }
    const checks: DatabaseAuditCheck[] = [
      {
        name: 'tables_without_primary_key',
        severity: 'error',
        count: tables.filter((t) => !t.has_pk).length,
      },
    ];
    const check = async (name: string, severity: DatabaseAuditCheck['severity'], sql: string) => {
      const [{ count }] = await manager.query<Array<{ count: number }>>(sql);
      checks.push({ name, severity, count: Number(count) });
    };
    await check(
      'invalid_indexes',
      'error',
      `SELECT count(*)::int AS count FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','lapper','gearapps_meta') AND NOT i.indisvalid`,
    );
    await check(
      'normalized_summary_revision_duplicates',
      'error',
      `SELECT count(*)::int AS count FROM (SELECT lower(btrim(number)),lower(btrim(revision)) FROM public.part_summaries GROUP BY 1,2 HAVING count(*)>1)t`,
    );
    await check(
      'ambiguous_active_logins',
      'error',
      `WITH identifiers AS (
      SELECT id,lower(btrim(v)) AS identifier FROM public.users CROSS JOIN LATERAL unnest(ARRAY[email,username,"employeeNumber"])v
      WHERE active AND "deletedAt" IS NULL AND nullif(btrim(v),'') IS NOT NULL)
      SELECT count(*)::int AS count FROM(SELECT identifier FROM identifiers GROUP BY identifier HAVING count(DISTINCT id)>1)t`,
    );
    await check(
      'tray_count_mismatches',
      'error',
      `SELECT count(*)::int AS count FROM public.trays t WHERE t.enabled AND t.blade_count<>(SELECT count(*) FROM public.blade_tray bt WHERE bt.tray_id=t.id AND bt.enabled)`,
    );
    await check(
      'tray_summary_type_mismatches',
      'error',
      `SELECT count(*)::int AS count FROM public.blade_tray bt JOIN public.trays t ON t.id=bt.tray_id JOIN public.blades b ON b.id=bt.blade_id WHERE bt.enabled AND ((t.summary_id IS NOT NULL AND b.summary_id<>t.summary_id) OR (t.part_type_id IS NOT NULL AND b.part_type_id<>t.part_type_id))`,
    );
    for (const [table, column, name] of [
      ['blade_tray', 'blade_id', 'multiple_active_trays_for_blade'],
      ['container_tray', 'tray_id', 'multiple_active_containers_for_tray'],
      ['location_tray', 'tray_id', 'multiple_active_locations_for_tray'],
      ['cutter_machine_runs', 'machine_number', 'multiple_active_runs_for_machine'],
      ['cutter_build_blades', 'blade_id', 'multiple_active_builds_for_blade'],
    ])
      await check(
        name,
        'error',
        `SELECT count(*)::int AS count FROM(SELECT ${identifier(column)} FROM public.${identifier(table)} WHERE enabled GROUP BY 1 HAVING count(*)>1)t`,
      );
    await check(
      'simultaneous_tray_placement',
      'error',
      `SELECT count(*)::int AS count FROM public.trays t WHERE EXISTS(SELECT 1 FROM public.container_tray c WHERE c.tray_id=t.id AND c.enabled) AND EXISTS(SELECT 1 FROM public.location_tray l WHERE l.tray_id=t.id AND l.enabled)`,
    );
    const relation = async (name: string) => {
      const [row] = await manager.query<Array<{ present: string | null }>>(
        'SELECT to_regclass($1) AS present',
        [name],
      );
      return !!row.present;
    };
    if (await relation('gearapps_meta.gearset_findings')) {
      await check(
        'gearset_ratio_conflicts',
        'review',
        "SELECT count(*)::int AS count FROM gearapps_meta.gearset_findings WHERE 'ratio_disagrees_with_teeth'=ANY(issues)",
      );
      await check(
        'gearset_component_summary_conflicts',
        'review',
        "SELECT count(*)::int AS count FROM gearapps_meta.gearset_findings WHERE 'component_summary_number_differs'=ANY(issues)",
      );
    } else if (await relation('public.gearsets')) {
      await check(
        'gearset_ratio_conflicts',
        'review',
        `SELECT count(*)::int AS count FROM public.gearsets g
        JOIN public.parts r ON r.id=g.ring_part_id JOIN public.parts p ON p.id=g.pinion_part_id
        WHERE abs(g.ratio_value-r.teeth::numeric/nullif(p.teeth,0))>0.005`,
      );
      await check(
        'gearset_component_summary_conflicts',
        'review',
        `SELECT count(*)::int AS count FROM public.gearsets g
        JOIN public.parts r ON r.id=g.ring_part_id JOIN public.parts p ON p.id=g.pinion_part_id
        JOIN public.part_summaries s ON s.id=g.summary_id JOIN public.part_summaries rs ON rs.id=r.summary_id JOIN public.part_summaries ps ON ps.id=p.summary_id
        WHERE lower(btrim(s.number)) IS DISTINCT FROM lower(btrim(rs.number)) OR lower(btrim(s.number)) IS DISTINCT FROM lower(btrim(ps.number))`,
      );
    }
    if (await relation('public.gearsets'))
      await check(
        'invalid_gearset_components',
        'error',
        `SELECT count(*)::int AS count FROM public.gearsets g
      JOIN public.parts gp ON gp.id=g.gearset_part_id JOIN public.part_types gt ON gt.id=gp.part_type_id
      JOIN public.parts r ON r.id=g.ring_part_id JOIN public.part_types rt ON rt.id=r.part_type_id
      JOIN public.parts p ON p.id=g.pinion_part_id JOIN public.part_types pt ON pt.id=p.part_type_id
      WHERE gt.code<>'GEARSET' OR rt.code<>'RING' OR pt.code<>'PINION' OR gp.summary_id<>g.summary_id OR r.teeth IS NULL OR p.teeth IS NULL OR r.teeth<=0 OR p.teeth<=0`,
      );
    if (await relation('lapper.machine_cycles')) {
      const [{ recorded }] = await manager.query<Array<{ recorded: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='lapper' AND table_name='machine_cycles' AND column_name='recorded_at') AS recorded`,
      );
      await check(
        'duplicate_cycle_events',
        'error',
        `SELECT count(*)::int AS count FROM (SELECT machine_id,gearset_id,timestamp,${recorded ? 'recorded_at' : 'NULL::timestamptz'},consec,serial_number FROM lapper.machine_cycles GROUP BY 1,2,3,4,5,6 HAVING count(*)>1)t`,
      );
      await check(
        'duplicate_cycle_macro_values',
        'error',
        `SELECT count(*)::int AS count FROM(SELECT machine_cycle_id,macro_id FROM lapper.macro_logs GROUP BY 1,2 HAVING count(*)>1)t`,
      );
      await check(
        'active_macro_number_duplicates',
        'error',
        `SELECT count(*)::int AS count FROM(SELECT number FROM lapper.macros WHERE status=1 GROUP BY 1 HAVING count(*)>1)t`,
      );
      await check(
        'shared_machine_addresses',
        'review',
        `SELECT count(*)::int AS count FROM(SELECT machine_ip FROM lapper.machines GROUP BY 1 HAVING count(*)>1)t`,
      );
      await check(
        'pending_legacy_gearset_references',
        'info',
        `SELECT count(*)::int AS count FROM lapper.gearsets WHERE public_gearset_id IS NULL`,
      );
      if (await relation('lapper.machine_cycle_archive')) {
        await check(
          'cycle_archive_hash_mismatches',
          'error',
          `SELECT count(*)::int AS count FROM lapper.machine_cycle_archive WHERE row_hash<>md5(original_data::text)`,
        );
        await check(
          'macro_archive_hash_mismatches',
          'error',
          `SELECT count(*)::int AS count FROM lapper.macro_log_archive WHERE row_hash<>md5(original_data::text)`,
        );
      }
    }
    const migrations = (await relation('gearapps_meta.schema_migrations'))
      ? (
          await manager.query<Array<{ version: string }>>(
            'SELECT version FROM gearapps_meta.schema_migrations ORDER BY version',
          )
        ).map((m) => m.version)
      : [];
    const expected = ['20261109-shared-core-integrity-v1', '20261109-shared-gearset-schema-v1'];
    if (await relation('public.gearsets'))
      expected.push(
        '20261109-shared-gearset-integrity-v1',
        '20261109-shared-gearset-components-v1',
      );
    if (await relation('lapper.machine_cycles'))
      expected.push('20261109-lapper-history-integrity-v2', '20261109-lapper-archive-guard-v1');
    checks.push({
      name: 'pending_integrity_migrations',
      severity: 'error',
      count: expected.filter((v) => !migrations.includes(v)).length,
    });
    if (migrations.includes('20261109-lapper-archive-guard-v1')) {
      const [{ count }] = await manager.query<
        Array<{ count: number }>
      >(`SELECT count(*)::int AS count FROM pg_trigger
        WHERE (tgrelid=to_regclass('lapper.machine_cycle_archive') AND tgname='guard_cycle_archive' OR
          tgrelid=to_regclass('lapper.macro_log_archive') AND tgname='guard_macro_archive') AND tgenabled IN ('O','A')`);
      checks.push({ name: 'missing_archive_guards', severity: 'error', count: 2 - count });
    }
    if (migrations.includes('20261109-shared-gearset-components-v1')) {
      const [{ count }] = await manager.query<
        Array<{ count: number }>
      >(`SELECT count(*)::int AS count FROM pg_trigger WHERE
        (tgrelid=to_regclass('public.gearsets') AND tgname='guard_gearset_components' OR
         tgrelid=to_regclass('public.parts') AND tgname='guard_gearset_part_changes' OR
         tgrelid=to_regclass('public.part_types') AND tgname='guard_gearset_type_changes') AND tgenabled IN ('O','A')`);
      checks.push({
        name: 'missing_gearset_component_guards',
        severity: 'error',
        count: 3 - count,
      });
    }
    const failed =
      foreignKeyViolations.length > 0 || checks.some((c) => c.severity === 'error' && c.count > 0);
    const review = checks.some((c) => c.severity === 'review' && c.count > 0);
    return {
      status: failed ? 'failed' : review ? 'passed_with_review_items' : 'passed',
      tables: tables.length,
      rowCounts,
      foreignKeysChecked: foreignKeys.length,
      foreignKeyViolations,
      checks,
      migrations,
    };
  });
}

/** Uses only SQL identifier quoting; application values are always bound parameters. */
export async function compareOriginalProjection(
  manager: EntityManager,
  schema: string,
  table: string,
  columns: string[],
): Promise<Row> {
  const [row] = await manager.query<
    Row[]
  >(`SELECT count(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(r)::text,E'\\n' ORDER BY to_jsonb(r)::text),'')) AS hash
    FROM(SELECT ${columns.map(identifier).join(',')} FROM ${identifier(schema)}.${identifier(table)})r`);
  return row;
}
