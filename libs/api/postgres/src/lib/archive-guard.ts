export const LAPPER_ARCHIVE_GUARD_SQL = `
CREATE FUNCTION lapper.reject_archive_mutation() RETURNS trigger LANGUAGE plpgsql AS $archive_guard$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Legacy archive records are immutable; use the documented recovery procedure.';
  RETURN NULL;
END $archive_guard$;
CREATE TRIGGER guard_cycle_archive BEFORE UPDATE OR DELETE ON lapper.machine_cycle_archive
  FOR EACH ROW EXECUTE FUNCTION lapper.reject_archive_mutation();
CREATE TRIGGER guard_macro_archive BEFORE UPDATE OR DELETE ON lapper.macro_log_archive
  FOR EACH ROW EXECUTE FUNCTION lapper.reject_archive_mutation();
`;
