# MeshForge 70.3.0 database integrity update

Lapper, Lapper Read and the manufacturing applications use one PostgreSQL 16
database. Public users, departments, machines, parts, summaries and gearset
assemblies are the canonical masters. The `lapper` schema contains machine
configuration, collector state and production history linked to those masters.
Lapper Read collects through the authenticated shared MeshForge API.

The private update package imports the supplied legacy Lapper history and then
applies the integrity migrations in **one transaction**. It takes a fresh backup
of the chosen target first. Operational SQL, dumps and row-level review reports
are supplied privately and excluded from Git, source ZIPs and Docker contexts.

## Run on the database host

Extract the complete private database-update ZIP. Stop the shared MeshForge API
and collection for the maintenance window; leave PostgreSQL running. Keep the
updated API stopped until this script succeeds. Preserve collector checkpoint files and the existing
PostgreSQL volume. Identify the container with `docker ps`, then run:

```powershell
./Apply-DatabaseCleanup.ps1 -PgContainer YOUR_POSTGRES_CONTAINER -Database MeshForge
```

Or, on Linux:

```sh
bash ./Apply-DatabaseCleanup.sh YOUR_POSTGRES_CONTAINER MeshForge
```

An explicit database username can be passed with `-DatabaseUser` or as the third
Bash argument. Otherwise the runner reads the container's `POSTGRES_USER`.
The runner checks the SQL checksum, verifies a fresh custom-format backup under
`backups/`, applies the transaction and runs `validate.sql`. A migration error
rolls back the transaction. Review the output before restarting collection.

Deploy the accompanying source before restarting Lapper. Keep the shared API on
`DATABASE_SYNCHRONIZE=false`, the same database and existing JWT access/refresh signing keys. Follow [Lapper setup](LAPPER_POSTGRES.md).
Normal manufacturing startup now rejects PostgreSQL schema synchronization too.
The existing one-shot fresh-database bootstrap permits it only inside its scoped
initialization after confirming that the public schema is empty.

The branch containing this update can be cloned explicitly:

```sh
git clone --branch codex/lapper-postgres-70-3-0 --single-branch https://github.com/ryan1393/GearApps.git
cd MeshForge
```

The complete source ZIP in the private package is the other deployment option.
Keep the host's existing `.env`; do not replace its credentials.
The `MeshForge-70.3.0-cleaned.dump` is a tested reference restore of the supplied
snapshot. Use the update script against an existing database to retain records
added since that snapshot. A reference dump is not an incremental update.

## What changes

- Shared schema changes use the existing manufacturing advisory lock and six
  checksummed migration versions in `meshforge_meta.schema_migrations`. The unified
  API adds a fresh-install gearset schema migration while preserving the original
  five migration bodies and checksums. Concurrent
  startup and reruns apply each version once; changed installed SQL is rejected.
- Missing references to machines, locations, users and shared master data become
  validated foreign keys. Normalized unique keys prevent ambiguous accounts,
  machine numbers, part numbers, departments and summary revisions. Summary
  uniqueness includes its revision, so legitimate revisions remain separate.
- Targeted operational indexes support history and inventory access. Existing
  inventory transactions and application routes remain in place.
- Deferred component guards enforce GEARSET/RING/PINION roles, positive teeth and
  the assembly part's summary. They validate the final transaction state, so
  legitimate coordinated master-data changes remain possible. They do not
  recalculate stored ratios or force component revisions to be identical.
- Exact cycle events and repeated macro snapshots are consolidated. Conflicting
  values for the same event/macro abort migration instead of choosing a value.
  Natural database keys also protect collector retries with different request
  keys. A conflicting new macro value returns HTTP 409.
- Duplicate originals and the original versions of relinked logs are retained
  in immutable archives with checksums. Alias views resolve old IDs through the
  API, and `machine_cycles_with_legacy` / `macro_logs_with_legacy` reconstruct the
  original imported rows. Both original local timestamps and new offset-aware
  collector timestamps remain intact.
- Lapper tokens include the shared account's authentication version. Disabling
  an account or changing that version revokes its Lapper access as well.

The combined private SQL recognizes its legacy source import marker and skips
that import on rerun. It refuses the unsupported case where cleanup was applied
before this particular legacy import; reconcile that case on staging first.

## Preserved review items

The owner chose to **preserve the eight stored ratios and flag them for review**.
No tooth counts or ratios are guessed. Nine assemblies also have components
from a different summary number; these remain flagged, while revisions of the
same summary number are allowed. One shared machine-address group and two
pending legacy gearset references remain visible for review.

See the private `master-data-review.txt` for the affected records and
`database-audit-report.json` for structural checks. A `passed_with_review_items`
result is expected while those decisions remain outstanding.

The supplied merged baseline contains 83 tables and 212,331 rows. The cleanup
removes 740 redundant working cycles and 3,369 redundant working macro logs,
leaving 69,136 cycles and 124,007 logs. Archives retain 740 original cycle rows
and 3,674 original log rows, including 305 retained logs whose cycle references
changed. Verification compares every original column across all original tables
against working data plus the reconstruction views.

## Audit and development checks

With `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`
and `DATABASE_NAME` set, run the read-only audit:

```sh
npm run db:audit -- --output database-reports/audit.json
npm run db:cleanup:plan -- --output tools/database/cleanup.sql
```

The generated schema-only plan does not include the private legacy records.
The private bundle builder requires the original validated merge package:

```sh
npm run db:cleanup:bundle -- --legacy-dir /private/merge-package --output /private/update-package
```

The regression tests require disposable restored databases and explicit test
authorization. Never point them at production:

```sh
# Pristine merged restore, database name ending in _integrity_test:
MESHFORGE_ALLOW_TEST_ACCOUNTS=YES npm run test:database-integrity
# Separate restored copy, database name ending in _lapper_test:
MESHFORGE_ALLOW_TEST_ACCOUNTS=YES npm run test:lapper-postgres
```

The integrity suite tests conflicting-history rollback, preservation of every
original field, concurrent replay, unique/FK/component constraints, immutable
archives and checksum mismatch refusal. The HTTP suite exercises shared login,
revocation, historical IDs, catalog revisions, collector retries and telemetry.
It intentionally leaves fixture history in its disposable database.

## Recovery

The runner's fresh before-update backup is the recovery point for the actual
target. Retain the current database before any recovery and account for newer
production records. Original imported history can also be queried through the
archive and reconstruction views without restoring the entire database.

Run `npm run test:database-integrity` against a disposable restored copy to
repeat that verification.
