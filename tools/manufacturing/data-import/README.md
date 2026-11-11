# Fresh MeshForge Data Import

This folder contains the canonical fresh migration workflow.

## Safe preflight

```powershell
npm run import:all-fresh
```

This reads the legacy SQL Server only and stages fresh snapshots under `tools/manufacturing/data-import/work/`. It also merges and validates the cleaned Excel-derived reference data. PostgreSQL is not changed.

## Apply

```powershell
npm run import:all-fresh:apply
```

Apply order:

1. Fresh SQL Server base/master export.
2. Merge Excel-derived summary additions, blade requirements, cutter definitions, and cutter-body MF/Dana mappings.
3. Import/upsert combined base/reference data into PostgreSQL.
4. Fresh SQL Server cutter-history export.
5. Dry-run/reconcile the fresh history against the newly imported reference data.
6. Transactionally refresh cutter operational/history rows while preserving physical cutter-body UUIDs and Excel MF/Dana mappings.

SQL Server is read-only.

The working snapshots are intentionally retained for audit and are excluded from Git by `.gitignore`.

## Clear operational data (keep users and base data)

```powershell
npm run clear:operational-data        # preview: counts of what is emptied and kept
npm run clear:operational-data:apply  # stop the API first
```

`clear-operational-data.mjs` empties blades, trays, containers, all locations, cutter builds and their history, coater shipments, Greenshed/DSF counts and the Cancel Last journal. Users, base/master data, cutter bodies, settings and the Lapper schema are kept. The `EMPTY` and `KEEP` lists at the top of the script are the source of truth; `test-clear-operational-data-contract.mjs` checks them. `commands\CLEAR-OPERATIONAL-DATA.cmd` previews and then asks for `CLEAR DATA`.

For a database in Docker (no Node.js needed), `commands\CLEAR-OPERATIONAL-DATA-DOCKER.cmd` runs `Clear-OperationalData-Docker.ps1`: preview, `CLEAR DATA`, `pg_dump` backup, then `clear-operational-data.sql` inside the PostgreSQL container. That SQL file is generated from the same lists; regenerate it after changing them with `node tools/manufacturing/data-import/clear-operational-data.mjs --write-sql` (the contract test fails if it is stale).
