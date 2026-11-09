require('./runtime.cjs');
const {
  SHARED_CORE_INTEGRITY_SQL,
  GEARSET_INTEGRITY_SQL,
  GEAR_DATABASE_SCHEMA_LOCK,
  migrationChecksum,
  GEARSET_COMPONENT_INTEGRITY_SQL,
} = require('@gearapps/shared/database');
const { LAPPER_POSTGRES_DDL } = require('../../libs/api/postgres/src/lib/schema.ts');
const {
  LAPPER_HISTORY_INTEGRITY_SQL,
} = require('../../libs/api/postgres/src/lib/history-integrity.ts');
const { LAPPER_ARCHIVE_GUARD_SQL } = require('../../libs/api/postgres/src/lib/archive-guard.ts');
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
function migration(version, sql, condition = 'true') {
  const checksum = migrationChecksum(sql);
  if (sql.includes('$gearapps_migration$')) throw new Error('SQL delimiter collision');
  return `DO $gearapps_migration$
DECLARE installed text;
BEGIN
  IF ${condition} THEN
    SELECT checksum INTO installed FROM gearapps_meta.schema_migrations WHERE version=${literal(version)};
    IF installed IS NOT NULL AND installed<>${literal(checksum)} THEN
      RAISE EXCEPTION 'Installed migration checksum differs: %',${literal(version)};
    END IF;
    IF installed IS NULL THEN
      ${sql}
      INSERT INTO gearapps_meta.schema_migrations(version,checksum) VALUES(${literal(version)},${literal(checksum)});
    END IF;
  END IF;
END $gearapps_migration$;`;
}
function cleanupPlan() {
  const lapper = "to_regclass('lapper.machines') IS NOT NULL";
  return `-- GearApps 70.3.0 integrity cleanup. Back up the target first.
-- Apply the legacy merge before this cleanup. All changes are transactional.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
${GEAR_DATABASE_SCHEMA_LOCK};
CREATE SCHEMA IF NOT EXISTS gearapps_meta;
CREATE TABLE IF NOT EXISTS gearapps_meta.schema_migrations (
  version text PRIMARY KEY,checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),applied_by text NOT NULL DEFAULT session_user
);
${migration('20261109-shared-core-integrity-v1', SHARED_CORE_INTEGRITY_SQL)}
${migration('20261109-shared-gearset-integrity-v1', GEARSET_INTEGRITY_SQL, "to_regclass('public.gearsets') IS NOT NULL")}
${migration('20261109-shared-gearset-components-v1', GEARSET_COMPONENT_INTEGRITY_SQL, "to_regclass('public.gearsets') IS NOT NULL")}
DO $lapper_base$
BEGIN
  IF ${lapper} THEN
    CREATE TABLE IF NOT EXISTS lapper.api_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT clock_timestamp());
    IF NOT EXISTS(SELECT 1 FROM lapper.api_migrations WHERE version='20261109-postgres-lapper-v1') THEN
      ${LAPPER_POSTGRES_DDL}
      INSERT INTO lapper.api_migrations(version) VALUES('20261109-postgres-lapper-v1');
    END IF;
  END IF;
END $lapper_base$;
${migration('20261109-lapper-history-integrity-v2', LAPPER_HISTORY_INTEGRITY_SQL, lapper)}
${migration('20261109-lapper-archive-guard-v1', LAPPER_ARCHIVE_GUARD_SQL, lapper)}
COMMIT;
-- Refresh planner statistics after releasing schema/data locks.
ANALYZE;
`;
}
module.exports = { cleanupPlan };
