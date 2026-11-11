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
