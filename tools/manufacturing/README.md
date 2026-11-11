# MeshForge Tools

Operational scripts and data utilities live in this folder.

## Main scripts

| Script | Purpose |
| --- | --- |
| `setup-meshforge.ps1` | First-time/dependency setup |
| `start-meshforge.ps1` | Start API and all three applications |
| `run-all-tests.ps1` | Master test runner |
| `smoke-test-api.ps1` | Read-only API smoke checks |
| `test-all-api-routes.ps1` | API route compatibility checks |
| `test-shelf-location-conventions.ps1` | `G` / `CGD` / `CGF` shelf checks |
| `test-full-workflow.ps1` | Connected workflow preflight/execution |
| `api-route-manifest.json` | Expected API route manifest |

## Test data

`test-data/ensure-workflow-test-fixtures.mjs` is the shared fixture provisioner.

`test-data/ensure-blade-tracking-fake-data.ps1` is the operator-friendly Blade Tracking wrapper.

Run:

```powershell
npm run test:blade-data
```

Created operational test records use the `E2E-` prefix. Shelf fixtures follow the production naming convention and are only created when missing; conflicting existing locations cause provisioning to fail rather than being overwritten.

## Data utilities

Import/export/base-data utilities are intentionally kept under `tools/manufacturing/`. Do not move these scripts back into the project root.

See `../docs/START_AND_TEST_GUIDE.md` for normal operating instructions.

### Cutter reference workbook

The cleaned source workbook is `base-data/source/cutter-body-info-BASE-DATA-READY.xlsx`. The importer uses the generated JSON files in `base-data/data/`.

```powershell
npm run validate:base-data
npm run import:base-data
```

The import adds 15 missing summaries, 216 blade requirements, and 120 unambiguous cutter-body/manufacturing-serial mappings. Duplicate cutter-body mappings stay in the workbook review sheet and are not imported.

## Cutter-body MF → Dana transition test

`test-cutter-body-dana-assignment.ps1` verifies that an MF-only cutter can later receive a Dana S/N without changing its cutter-body UUID, both identifiers continue resolving the same body, and duplicate Dana assignment is blocked.


## Fresh all-data import

`data-import/import-all-fresh.ps1` is the canonical migration orchestrator.

```powershell
npm run import:all-fresh
npm run import:all-fresh:apply
```

It combines fresh SQL Server base/master data, fresh SQL Server cutter history, and the cleaned Excel-derived summary/blade/cutter reference package. SQL Server is read-only. The apply path refreshes PostgreSQL only after the fresh source package validates.

## Live release regression checks

`node --env-file=.env tools/manufacturing/test-release-regressions.mjs` checks real operator
permissions, refresh-token rotation/replay, credential serialization, and inventory
mutation safeguards against a running API and a dedicated test database. Set
`MESHFORGE_ALLOW_TEST_ACCOUNTS=YES`, inject the usual `DATABASE_*` settings, and set
`MESHFORGE_BASE_URL` if the API is not at `http://localhost:3333/api/v1`.

Load base/reference data first. The script creates unique accounts and a tray,
uses only its own fixtures, and removes them in `finally`. It never prints passwords
or bearer tokens. Do not run it against production.
