import { createHash } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { GEARSET_SCHEMA_SQL } from './gearset-schema';
import { GEARSET_COMPONENT_INTEGRITY_SQL } from './gearset-components';

/** Same lock as manufacturing's startup routines; always acquire it first. */
export const GEAR_DATABASE_SCHEMA_LOCK =
  "SELECT pg_advisory_xact_lock(hashtext('dana-gear-startup-schema'))";

export const migrationChecksum = (sql: string): string =>
  createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

/**
 * Before the rename to MeshForge the bookkeeping schema was `gearapps_meta` and the built-in
 * local accounts used `@gearapps.local` addresses. A database created by that version is adopted
 * in place: the schema is renamed (its tables, view, function and triggers move with it) and the
 * local addresses are rewritten. Safe to run every start; it does nothing once adopted.
 */
export const LEGACY_NAME_ADOPTION_SQL = `
DO $meshforge_adoption$
DECLARE other_objects integer; recorded bigint := 0;
BEGIN
  IF to_regnamespace('gearapps_meta') IS NOT NULL THEN
    IF to_regnamespace('meshforge_meta') IS NOT NULL THEN
      SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='meshforge_meta' AND c.relname NOT IN ('schema_migrations','schema_migrations_pkey'))
           + (SELECT count(*) FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='meshforge_meta')
        INTO other_objects;
      IF to_regclass('meshforge_meta.schema_migrations') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM meshforge_meta.schema_migrations' INTO recorded;
      END IF;
      IF other_objects>0 OR recorded>0 THEN
        RAISE EXCEPTION 'Both gearapps_meta and meshforge_meta are in use; keep one and drop the other before starting MeshForge.';
      END IF;
      DROP SCHEMA meshforge_meta CASCADE;
    END IF;
    ALTER SCHEMA gearapps_meta RENAME TO meshforge_meta;
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    UPDATE public.users u SET email=replace(u.email,'@gearapps.local','@meshforge.local')
     WHERE u.email LIKE '%@gearapps.local'
       AND NOT EXISTS (SELECT 1 FROM public.users x
                        WHERE lower(x.email)=lower(replace(u.email,'@gearapps.local','@meshforge.local')));
  END IF;
END $meshforge_adoption$;`;

/** The checksum a migration had when its SQL still named the `gearapps_meta` schema. */
export const legacyMigrationChecksum = (sql: string): string =>
  migrationChecksum(sql.replaceAll('meshforge_meta', 'gearapps_meta'));

export async function runDatabaseMigration(
  manager: EntityManager,
  version: string,
  sql: string,
): Promise<void> {
  await manager.query(LEGACY_NAME_ADOPTION_SQL);
  await manager.query('CREATE SCHEMA IF NOT EXISTS meshforge_meta');
  await manager.query(`CREATE TABLE IF NOT EXISTS meshforge_meta.schema_migrations (
    version text PRIMARY KEY, checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(), applied_by text NOT NULL DEFAULT session_user
  )`);
  const checksum = migrationChecksum(sql);
  const [installed] = await manager.query<Array<{ checksum: string }>>(
    'SELECT checksum FROM meshforge_meta.schema_migrations WHERE version=$1',
    [version],
  );
  if (installed) {
    if (installed.checksum === checksum) return;
    // Applied before the rename: the same migration, recorded under its old checksum.
    if (installed.checksum === legacyMigrationChecksum(sql)) {
      await manager.query(
        'UPDATE meshforge_meta.schema_migrations SET checksum=$2 WHERE version=$1',
        [version, checksum],
      );
      return;
    }
    throw new Error('Installed database migration checksum differs: ' + version);
  }
  await manager.query(sql);
  await manager.query(
    'INSERT INTO meshforge_meta.schema_migrations(version,checksum) VALUES ($1,$2)',
    [version, checksum],
  );
}

export const SHARED_CORE_INTEGRITY_SQL = `
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username character varying,
  ADD COLUMN IF NOT EXISTS "authVersion" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" character varying,
  ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" timestamp;

-- These are normalized business keys, not duplicate copies of master records.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_normalized ON public.users(lower(btrim(email)))
  WHERE nullif(btrim(email),'') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_normalized ON public.users(lower(btrim(username)))
  WHERE nullif(btrim(username),'') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_employee_normalized ON public.users(lower(btrim("employeeNumber")))
  WHERE nullif(btrim("employeeNumber"),'') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_parts_number_normalized ON public.parts(lower(btrim(part_number)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_machines_number_normalized ON public.machines(lower(btrim(machine_number)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_code_normalized ON public.departments(lower(btrim(code)));
-- Revisions are distinct identities. Never deduplicate summaries by number alone.
CREATE UNIQUE INDEX IF NOT EXISTS uq_summaries_number_revision_normalized
  ON public.part_summaries(lower(btrim(number)),lower(btrim(revision)));

DO $integrity$
DECLARE r record; source_oid oid; target_oid oid; source_att smallint; target_att smallint; existing_name text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('container_tray','packed_from_location_id','locations','id','fk_container_tray_packed_from_location'),
    ('cutter_builds','cutter_builder_machine_id','machines','id','fk_cutter_builds_builder_machine'),
    ('cutter_body_shelf_placements','placed_by','users','id','fk_cutter_shelf_placed_by'),
    ('cutter_body_shelf_placements','removed_by','users','id','fk_cutter_shelf_removed_by'),
    ('summary_blade_overrides','updated_by','users','id','fk_summary_blade_overrides_updated_by')
  ) AS items(tbl,col,target_tbl,target_col,fk_name) LOOP
    source_oid:=to_regclass(format('public.%I',r.tbl)); target_oid:=to_regclass(format('public.%I',r.target_tbl));
    IF source_oid IS NULL OR target_oid IS NULL THEN CONTINUE; END IF;
    SELECT attnum INTO source_att FROM pg_attribute WHERE attrelid=source_oid AND attname=r.col AND NOT attisdropped;
    SELECT attnum INTO target_att FROM pg_attribute WHERE attrelid=target_oid AND attname=r.target_col AND NOT attisdropped;
    IF source_att IS NULL OR target_att IS NULL THEN CONTINUE; END IF;
    SELECT conname INTO existing_name FROM pg_constraint WHERE contype='f' AND conrelid=source_oid
      AND confrelid=target_oid AND conkey=ARRAY[source_att] AND confkey=ARRAY[target_att] LIMIT 1;
    IF existing_name IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) NOT VALID',
        r.tbl,r.fk_name,r.col,r.target_tbl,r.target_col);
      existing_name:=r.fk_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',r.tbl,existing_name);
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('parts','ck_parts_positive_teeth','teeth IS NULL OR teeth > 0'),
    ('parts','ck_parts_nonblank_number','btrim(part_number) <> '''''),
    ('machines','ck_machines_nonblank_number','btrim(machine_number) <> '''''),
    ('departments','ck_departments_nonblank_code','btrim(code) <> '''''),
    ('part_summaries','ck_summaries_nonblank_number','btrim(number) <> '''''),
    ('roll_masters','ck_roll_masters_nonnegative_quantities','current_quantity >= 0 AND minimum_quantity >= 0'),
    ('trays','ck_trays_nonnegative_blade_count','blade_count >= 0')
  ) AS items(tbl,check_name,expression) LOOP
    source_oid:=to_regclass(format('public.%I',r.tbl));
    IF source_oid IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=source_oid AND conname=r.check_name) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',r.tbl,r.check_name,r.expression);
    END IF;
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',r.tbl,r.check_name);
  END LOOP;

  -- Only operational access paths. Audit-actor FKs do not justify blanket indexes.
  FOR r IN SELECT * FROM (VALUES
    ('blade_history','ix_blade_history_blade_time','(blade_id,"createdAt" DESC)'),
    ('blade_tray','ix_blade_tray_tray_enabled','(tray_id,enabled,blade_id)'),
    ('blade_tray','ix_blade_tray_blade_history','(blade_id,enabled)'),
    ('blades','ix_blades_summary_type_enabled','(summary_id,part_type_id,enabled)'),
    ('container_tray','ix_container_tray_container_enabled','(container_id,enabled,tray_id)'),
    ('location_tray','ix_location_tray_location_enabled','(location_id,enabled,tray_id)'),
    ('cutter_build_blades','ix_cutter_build_blades_blade_history','(blade_id,enabled)'),
    ('cutter_builds','ix_cutter_builds_summary_type_status','(summary_id,part_type_id,status_id)'),
    ('cutter_machine_runs','ix_cutter_machine_runs_machine_history','(machine_id,enabled)'),
    ('cutter_machine_runs','ix_cutter_machine_runs_build_history','(cutter_build_id,enabled)'),
    ('tray_grinding_runs','ix_tray_grinding_runs_tray_time','(tray_id,"createdAt" DESC)')
  ) AS items(tbl,index_name,index_expression) LOOP
    IF to_regclass(format('public.%I',r.tbl)) IS NOT NULL THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I %s',r.index_name,r.tbl,r.index_expression);
    END IF;
  END LOOP;
END $integrity$;
`;

export const GEARSET_INTEGRITY_SQL = `
DO $gearset_integrity$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('created_by','fk_gearsets_created_by'),('updated_by','fk_gearsets_updated_by')) AS items(col,fk_name) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.gearsets'::regclass AND conname=r.fk_name) THEN
      EXECUTE format('ALTER TABLE public.gearsets ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id) NOT VALID',r.fk_name,r.col);
    END IF;
    EXECUTE format('ALTER TABLE public.gearsets VALIDATE CONSTRAINT %I',r.fk_name);
  END LOOP;
END $gearset_integrity$;

CREATE OR REPLACE VIEW meshforge_meta.gearset_findings AS
SELECT g.id,gp.part_number AS gearset_number,g.ratio_value,g.ratio_text,
  r.teeth AS ring_teeth,p.teeth AS pinion_teeth,
  round(r.teeth::numeric/nullif(p.teeth,0),4) AS calculated_ratio,
  s.number AS summary_number,s.revision AS summary_revision,
  rs.number AS ring_summary_number,rs.revision AS ring_summary_revision,
  ps.number AS pinion_summary_number,ps.revision AS pinion_summary_revision,
  array_remove(ARRAY[
    CASE WHEN abs(g.ratio_value-r.teeth::numeric/nullif(p.teeth,0))>0.005 THEN 'ratio_disagrees_with_teeth' END,
    CASE WHEN lower(btrim(s.number)) IS DISTINCT FROM lower(btrim(rs.number)) OR
      lower(btrim(s.number)) IS DISTINCT FROM lower(btrim(ps.number)) THEN 'component_summary_number_differs' END
  ],NULL) AS issues
FROM public.gearsets g
JOIN public.parts gp ON gp.id=g.gearset_part_id JOIN public.parts r ON r.id=g.ring_part_id
JOIN public.parts p ON p.id=g.pinion_part_id JOIN public.part_summaries s ON s.id=g.summary_id
JOIN public.part_summaries rs ON rs.id=r.summary_id JOIN public.part_summaries ps ON ps.id=p.summary_id
WHERE abs(g.ratio_value-r.teeth::numeric/nullif(p.teeth,0))>0.005 OR
  lower(btrim(s.number)) IS DISTINCT FROM lower(btrim(rs.number)) OR
  lower(btrim(s.number)) IS DISTINCT FROM lower(btrim(ps.number));
`;

/**
 * A model is its number and type. Rows that differ only in the case or spacing of the type, or
 * that both have no type (the old unique index treats two blanks as different), are the same
 * model entered twice. They are merged into the oldest usable row, everything that pointed at
 * a duplicate is repointed to it, and a normalized unique index stops it happening again.
 * Models with the same number and a different type are different models and are left alone.
 */
export const MODEL_DUPLICATES_SQL = `
DO $models$
DECLARE reference record;
BEGIN
  IF to_regclass('public.models') IS NULL THEN RETURN; END IF;
  CREATE TEMP TABLE meshforge_model_merge ON COMMIT DROP AS
    SELECT id, first_value(id) OVER (
      PARTITION BY model_number, upper(btrim(coalesce(model_type,'')))
      ORDER BY (enabled AND active AND "deletedAt" IS NULL) DESC, "createdAt", id) AS keeper
    FROM public.models;
  DELETE FROM meshforge_model_merge WHERE id=keeper;
  FOR reference IN
    SELECT c.conrelid::regclass AS source, a.attname AS source_column
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
     WHERE c.contype='f' AND c.confrelid='public.models'::regclass AND array_length(c.conkey,1)=1
  LOOP
    EXECUTE format('UPDATE %s r SET %I=m.keeper FROM meshforge_model_merge m WHERE r.%I=m.id',
      reference.source, reference.source_column, reference.source_column);
  END LOOP;
  DELETE FROM public.models d USING meshforge_model_merge m WHERE d.id=m.id;
  UPDATE public.models SET model_type=nullif(btrim(model_type),'')
   WHERE model_type IS DISTINCT FROM nullif(btrim(model_type),'');
  CREATE UNIQUE INDEX IF NOT EXISTS uq_models_number_type_normalized
    ON public.models(coalesce(model_number,-1), upper(btrim(coalesce(model_type,''))));
END $models$;`;

export async function applySharedDatabaseIntegrity(manager: EntityManager): Promise<void> {
  await manager.query(GEAR_DATABASE_SCHEMA_LOCK);
  await runDatabaseMigration(manager, '20261109-shared-gearset-schema-v1', GEARSET_SCHEMA_SQL);
  await runDatabaseMigration(
    manager,
    '20261109-shared-core-integrity-v1',
    SHARED_CORE_INTEGRITY_SQL,
  );
  await runDatabaseMigration(manager, '20261111-shared-model-duplicates-v1', MODEL_DUPLICATES_SQL);
  const [gearsets] = await manager.query<Array<{ present: string | null }>>(
    "SELECT to_regclass('public.gearsets') AS present",
  );
  if (gearsets.present) {
    await runDatabaseMigration(
      manager,
      '20261109-shared-gearset-integrity-v1',
      GEARSET_INTEGRITY_SQL,
    );
    await runDatabaseMigration(
      manager,
      '20261109-shared-gearset-components-v1',
      GEARSET_COMPONENT_INTEGRITY_SQL,
    );
  }
}
