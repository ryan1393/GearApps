GearApps 70.3.0 database update: legacy Lapper merge and integrity cleanup

Run this on the computer that can access the GearApps PostgreSQL container.
Use PostgreSQL 16. The script finds POSTGRES_USER in the container unless you
supply the database username explicitly. No database password is printed.

1. Schedule the update and stop the shared GearApps API and Lapper Read
   collection during it. Leave the PostgreSQL container running.
   Keep the updated shared API stopped until step 3 succeeds.
   Keep every collector checkpoint/state file. Deploy the updated shared API
   before restarting the collectors, so old record IDs resolve through aliases.
   Keep DATABASE_SYNCHRONIZE=false on the shared API. Keep the existing PostgreSQL volume.

2. Extract the entire ZIP. List containers and identify the GearApps PostgreSQL one:
     docker ps --format "table {{.Names}}\t{{.Image}}"

3. From the extracted folder run ONE of these, replacing POSTGRES_CONTAINER:

   PowerShell (Windows or PowerShell 7):
     ./Apply-DatabaseCleanup.ps1 -PgContainer POSTGRES_CONTAINER -Database GearApps

   Bash (Linux):
     bash ./Apply-DatabaseCleanup.sh POSTGRES_CONTAINER GearApps

   If the database name differs, use its exact name. You can supply an explicit
   username using -DatabaseUser in PowerShell or the third Bash argument.

The script verifies the SQL checksums, creates and verifies a fresh custom-format
backup under backups/, then runs cleanup.sql in one transaction. That SQL imports
the missing old Lapper data when its completed-import marker is absent, and then
applies the cleanup. It does not restore or replace your live database from a dump.
Already imported data and already applied migrations are retained on replay.
If constraints, lock timeouts or conflicting snapshots stop the transaction,
the transaction rolls back and the pre-update backup remains available.

The preserved values and review items
  - Existing GearApps users, masters, inventory and audit history are retained.
  - Legitimate summary revisions remain separate records.
  - Exact duplicate Lapper cycles and macro snapshots are consolidated.
  - Original records/IDs remain in immutable archives and alias views.
  - The eight disputed ratios remain unchanged, as requested.
  - Cross-summary component assignments, duplicate machine addresses and two
    pending legacy gearset references are reported for review, not guessed.
  - The shared account authVersion supports revocation throughout the API.

Verification
  validate.sql checks all foreign keys, primary keys and archive hashes/guards,
  then displays master-data review counts. The source checkout also supports
  npm run db:audit with DATABASE_* environment variables for a fuller read-only
  report. A result with review items is expected until those items are resolved.
  See master-data-review.txt and database-audit-report.json in this package.

Application source
  Source: https://github.com/ryan1393/GearApps/tree/codex/lapper-postgres-70-3-0
  Clone: git clone --branch codex/lapper-postgres-70-3-0 --single-branch https://github.com/ryan1393/GearApps.git
  The accompanying source ZIP or this GitHub branch contains the
  updated shared API, collector, migration runner, audit command, and regression tests.
  Keep existing manufacturing/.env credentials and signing keys. Use the same JWT_ACCESS_SECRET / JWT_REFRESH_SECRET and PostgreSQL database
  for all applications. Lapper uses browser port 4203 and the shared API port 3333.

Backups and recovery
  The automatic before-update dump is the recovery point for YOUR running database.
  The separately supplied cleaned dump is a tested restore/reference artifact;
  applying cleanup.sql is the method that preserves data added after the supplied
  snapshot. Do not treat the reference dump as an incremental update.
  Before any recovery, retain the failed/current database and confirm that no
  newer production records would be discarded. Archives and *_with_legacy views
  retain the original imported history without reverting the whole database.

If this database was initialized with cleanup before legacy data was imported,
the combined script refuses that unsupported import order rather than silently
omitting history. Use the verified complete reference database on a separate
staging database and reconcile that case before replacing any live data.
