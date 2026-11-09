/**
 * Every routine that changes the database schema while the API starts
 * (ALTER TABLE, CREATE TRIGGER, ...) takes this one transaction-scoped lock
 * first. Without it they ran in parallel under separate locks and could
 * deadlock on shared tables such as cutter_builds.
 */
export const STARTUP_SCHEMA_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtext('dana-gear-startup-schema'))";
