# Database migrations

```
database/truck-log/migrations/
  0001_baseline.sql   full schema and seed data as of 1.0.0
  0002_stations.sql   station sign-in
  0003_late_print_agent_results.sql   late Print Agent results may replace a lease-monitor "uncertain" failure
  0004_packing_slip_watcher_routes.sql   SAP packing-slip watcher routes 1-8 (edited in Administration > Printing) and their audit history
  0005_print_workflow_recovery.sql   driver print workflow recovery
  0006_station_roles.sql   station types become roles: adds DOCK (CK65 dock handheld) and MANAGEMENT (view only)
  0007_station_rename.sql   stations can be renamed; the station audit log records RENAMED
```

`tools/truck-log/migrate.mjs` runs at every server start (from `docker/truck-log/server-entrypoint.sh`), before the API:

- It takes a PostgreSQL advisory lock, so two servers starting together cannot interleave.
- It applies each pending file in order, **each in its own transaction**, and records it in `public.truck_log_schema_migrations` with its SHA-256.
- It stops if an applied file was changed afterwards, if the database has a migration this release does not know, or if the database has Truck Log tables but no migration history (an old 0.1 test database).

```sh
npm run db:status     # or: docker compose exec truck-log-server node tools/truck-log/migrate.mjs --status
```

## Adding a change

1. Create the next file, e.g. `0005_short_name.sql`. Numbers have no gaps; names are lowercase with underscores.
2. Write plain SQL. Don't add `BEGIN`/`COMMIT`; the runner wraps the file in a transaction.
3. Never edit a migration that any database has applied. Fix forward with a new file.
4. Run `npm run test:migrations`, then start the server against a copy of production data.

## About the baseline

`0001_baseline.sql` replaces the ten 0.1 migrations (001–010) and the separate admin-account migration. It was generated with `pg_dump` from a PostgreSQL 16 database built by that chain, and checked against it:

- Schema and seed data are identical to a dump-and-restore of the 0.1 chain. The original chain differs from its own restore only in how PostgreSQL prints `IN (...)` lists.
- The 0.1 semantic schema verifiers produced the same results on both databases.

There are two deliberate differences:

- The old runner's checksum row `app_settings.automatic_driver_print_schema_v1` is gone.
- The admin schema version is `truck-log-admin-v1`.

The admin tables are part of the baseline. `SETUP-TRUCK-LOG-ADMIN --bootstrap` only creates the first account.

`0005_print_workflow_recovery.sql` adds the persisted manual-printing choice, append-only cancellation/replacement history for automatic jobs never leased to Windows, and audited failure transitions for unavailable queued printers. Original frozen destinations and documents remain immutable.

Release 1.0.1 adds `0005_print_workflow_recovery.sql` for persisted manual printing and append-only never-leased job recovery. Earlier applied SQL files are unchanged. Back up the database and document volume before upgrading.
