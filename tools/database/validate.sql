-- Read-only post-cleanup verification. No database values are repaired here.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
DO $verify_integrity$
DECLARE k record; matches text; nonnulls text; violations bigint; table_count integer;
BEGIN
  IF EXISTS(SELECT version FROM (VALUES
    ('20261109-shared-core-integrity-v1'),('20261109-shared-gearset-integrity-v1'),
    ('20261109-shared-gearset-components-v1'),('20261109-shared-gearset-schema-v1')) required(version)
    WHERE NOT EXISTS(SELECT 1 FROM meshforge_meta.schema_migrations m WHERE m.version=required.version)) THEN
    RAISE EXCEPTION 'A required shared integrity migration is missing';
  END IF;
  SELECT count(*) INTO violations FROM pg_trigger WHERE
    (tgrelid='public.gearsets'::regclass AND tgname='guard_gearset_components' OR
     tgrelid='public.parts'::regclass AND tgname='guard_gearset_part_changes' OR
     tgrelid='public.part_types'::regclass AND tgname='guard_gearset_type_changes') AND tgenabled IN ('O','A');
  IF violations<>3 THEN RAISE EXCEPTION 'Gearset component guards are missing or disabled'; END IF;
  SELECT count(*) INTO table_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','lapper','meshforge_meta') AND c.relkind IN ('r','p')
    AND NOT EXISTS(SELECT 1 FROM pg_constraint p WHERE p.conrelid=c.oid AND p.contype='p');
  IF table_count>0 THEN RAISE EXCEPTION '% tables have no primary key',table_count; END IF;
  FOR k IN SELECT c.*,n.nspname AS source_schema,t.relname AS source_table,rn.nspname AS target_schema,rt.relname AS target_table
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_class rt ON rt.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=rt.relnamespace
    WHERE c.contype='f' AND n.nspname IN ('public','lapper','meshforge_meta') LOOP
    IF NOT k.convalidated THEN RAISE EXCEPTION 'Unvalidated foreign key: %',k.conname; END IF;
    SELECT string_agg(format('r.%I=p.%I',a.attname,b.attname),' AND ' ORDER BY x.ord),
      string_agg(format('r.%I IS NOT NULL',a.attname),' AND ' ORDER BY x.ord)
      INTO matches,nonnulls
    FROM unnest(k.conkey,k.confkey) WITH ORDINALITY x(source_num,target_num,ord)
    JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.source_num
    JOIN pg_attribute b ON b.attrelid=k.confrelid AND b.attnum=x.target_num;
    EXECUTE format('SELECT count(*) FROM %I.%I r WHERE %s AND NOT EXISTS(SELECT 1 FROM %I.%I p WHERE %s)',
      k.source_schema,k.source_table,nonnulls,k.target_schema,k.target_table,matches) INTO violations;
    IF violations>0 THEN RAISE EXCEPTION '% orphan rows for %',violations,k.conname; END IF;
  END LOOP;
  IF to_regclass('lapper.machine_cycle_archive') IS NOT NULL THEN
    IF (SELECT count(*) FROM meshforge_meta.schema_migrations WHERE version IN
      ('20261109-lapper-history-integrity-v2','20261109-lapper-archive-guard-v1'))<>2 THEN
      RAISE EXCEPTION 'A required Lapper integrity migration is missing';
    END IF;
    IF EXISTS(SELECT 1 FROM lapper.machine_cycle_archive WHERE row_hash<>md5(original_data::text)) OR
      EXISTS(SELECT 1 FROM lapper.macro_log_archive WHERE row_hash<>md5(original_data::text)) THEN
      RAISE EXCEPTION 'An original archive checksum failed';
    END IF;
    SELECT count(*) INTO violations FROM pg_trigger WHERE
      (tgrelid='lapper.machine_cycle_archive'::regclass AND tgname='guard_cycle_archive' OR
       tgrelid='lapper.macro_log_archive'::regclass AND tgname='guard_macro_archive') AND tgenabled IN ('O','A');
    IF violations<>2 THEN RAISE EXCEPTION 'Archive immutability guards are missing or disabled'; END IF;
  END IF;
END $verify_integrity$;
SELECT jsonb_build_object(
  'result','structural_checks_passed',
  'migrations',(SELECT jsonb_agg(version ORDER BY version) FROM meshforge_meta.schema_migrations),
  'gearsets_with_ratio_conflicts',(SELECT count(*) FROM meshforge_meta.gearset_findings WHERE 'ratio_disagrees_with_teeth'=ANY(issues)),
  'gearsets_with_component_summary_conflicts',(SELECT count(*) FROM meshforge_meta.gearset_findings WHERE 'component_summary_number_differs'=ANY(issues))
) AS verification;
COMMIT;
