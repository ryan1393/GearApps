# MeshForge â€” Setup, Start, Test, and Test Data

This is the current operator/developer guide for the MeshForge workspace.

## Application names and departments

The applications are:

- **Blade Tracking**
- **Cutter Builder**
- **Green Shed**

**Cutter Builder** is the application name. **CUTTERGRIND** remains the department name used by the manufacturing workflow and database rules. Do not rename the CUTTERGRIND department to Cutter Builder.

The retired `Cuttergrind_Verified_Pull` workflow is not part of the current application or compatibility checks.

## First-time setup

From the project root:

```powershell
npm run setup:meshforge
```

The setup script:

1. automatically unblocks downloaded project files;
2. verifies Node.js and npm;
3. installs npm dependencies;
4. resets Nx;
5. verifies the required MeshForge projects.

The `.env` file is intentionally retained. Review its values before using a different environment.

## Start MeshForge

```powershell
npm run start:meshforge
```

You can also use `commands\START-MESHFORGE.cmd`.

The startup script automatically unblocks project files, reads `SERVER_PORT` from `.env` (default `3333`), starts the API, waits for the health endpoint, and starts Blade Tracking, Cutter Builder, and Green Shed.

## Run all tests

```powershell
npm run test:meshforge
```

The master test runner performs the harness checks, builds/tests, API route coverage, read-only smoke checks, shelf convention checks, and full-workflow preflight/optional execution.

### Quick harness-only check

```powershell
.\tools\manufacturing\run-all-tests.ps1 -HarnessOnly
```

This parses the PowerShell test scripts, validates their named parameter contracts, verifies required test files, and confirms the **114-route API manifest** without running the applications.

## Blade Tracking fake/test data

An empty development/test database can be populated with dedicated, clearly marked E2E records:

```powershell
npm run test:blade-data
```

The provisioner creates or reuses only the data needed to exercise Blade Tracking and the connected workflow:

| Purpose | Test data |
| --- | --- |
| Grinding/full workflow source | `E2E-SOURCE-*` tray |
| Source blades | required quantity of `E2E-BLADE-*` |
| Intake | empty `E2E-INTAKE-*` tray |
| Load/receive container | empty `E2E-CONTAINER-*` |
| Internal movement | `E2E-BT-LOC-A` and `E2E-BT-LOC-B` |
| Cuttergrind dull shelf | `CGDR-<summary>` (RING) / `CGDP-<summary>` (PINION) |
| Cuttergrind finished shelf | `CGFR-<summary>` (RING) / `CGFP-<summary>` (PINION) |
| Green Shed RING shelf | `GSR-<summary>` |
| Green Shed PINION shelf | `GSP-<summary>` |
| Workflow teardown | empty `E2E-TEARDOWN-*` tray; no location required until blades are returned |

The provisioner selects an enabled Summary/Part Type blade requirement if one is not supplied. It uses a PostgreSQL transaction and rolls back on failure. Existing conflicting locations are **not overwritten**.

The master `npm run test:meshforge` runner automatically provisions/reuses this data when required workflow inputs are missing. The generated coater container is also used automatically.

To prevent automatic test-data creation:

```powershell
.\tools\manufacturing\run-all-tests.ps1 -NoAutoTestData
```

### Important test-data rule

Records beginning with `E2E-` are development/test fixtures. Do not treat them as production manufacturing records.

## Shelf-location convention

Shelf tags are summary-number based:

- Green Shed: `GSR-<summary>` for RING / `GSP-<summary>` for PINION
- Cuttergrind dull: `CGDR-<summary>` (RING) / `CGDP-<summary>` (PINION)
- Cuttergrind finished: `CGFR-<summary>` (RING) / `CGFP-<summary>` (PINION)
- Empty tray: `EMPTY` + 0 blades + no active location is valid and means **Available / Ready to Use**.

Examples for summary `12345`:

```text
G12345
CGDR-12345
CGFR-12345
```

Green Shed uses the Green Shed department. Both dull and finished Cuttergrind shelves use the **CUTTERGRIND** department.

## Full workflow test

The normal master runner executes the complete workflow against dedicated `E2E-*` test data. Use `-PreflightOnly` only when you deliberately want a non-mutating diagnostic pass.

## Useful commands

```powershell
npm run setup:meshforge
npm run start:meshforge
npm run test:blade-data
npm run test:meshforge
npm run test:fixtures
```

Import/export utilities are kept under `tools/manufacturing/`.

## Recommended clean-machine sequence

```powershell
npm run setup:meshforge
npm run test:blade-data
npm run test:meshforge
npm run start:meshforge
```

If `test:meshforge` fails, use the first `[FAIL]` entry in the test summary as the starting point rather than rerunning later stages manually.


### Test-data database configuration

The Blade Tracking fixture provisioner uses the same `.env` database keys as the Nest API:

```text
DATABASE_HOST
DATABASE_PORT
DATABASE_USERNAME
DATABASE_PASSWORD
DATABASE_NAME
```

The provisioner uses Windows path-safe `.env` loading and validates these values before connecting. It never prints the database password. If a value is missing, the test stops with the exact missing setting name instead of a PostgreSQL SCRAM error.


### Empty reference-data database

If Blade Tracking has no enabled Summary/Part Type blade requirement, `npm run test:blade-data` now creates a dedicated fake reference set instead of failing:

```text
Summary number: E2E-BLADE-TEST
Revision:       TEST
Part type:      E2E
Blade count:    10
```

These records are exclusively for development/test use. The normal full workflow runner does **not** invent production-like cutter reference data; it still requires a real enabled blade requirement unless you are running the Blade Tracking fake-data command.

## Import cleaned cutter reference base data

The project includes the cleaned cutter workbook and generated base-data JSON files. Before running application workflow tests against a fresh database, import base data:

```powershell
npm run validate:base-data
npm run import:base-data
```

This adds the 15 missing summaries as active/enabled, imports all 216 unique blade requirements, and imports the 120 unambiguous cutter-body/manufacturing-serial mappings. The summaries can be disabled later without deleting their history.

## Cutter body scanning

Cutter Builder scans the **Dana serial number**.

- `serial_number` = Dana S/N = scanned cutter-body identifier
- `mf_serial_number` = MF S/N = reference/cross-reference only

Operators should not scan the MF serial number.


### Cutter-body transition lookup

During the cutter-body etching rollout, Cutter Builder accepts either identifier in the Cutter Body field:

- **Dana S/N** â€” preferred and canonical identifier; this is what will be scanned once the body is etched.
- **MF S/N** â€” temporary manual-entry fallback for bodies that have not been etched yet.

If an MF S/N is entered, MeshForge resolves it to the cutter body and immediately normalizes the selected body back to its Dana S/N. Builds and history continue to store/use the Dana serial as the canonical cutter-body serial.

If an MF S/N ever matches more than one enabled cutter body, MeshForge refuses to guess and requires the Dana S/N.

## Cutter bodies before and after etching

A cutter body exists in MeshForge before it receives a Dana etched serial.

Before etching:

```text
MF / manufacturer S/N = required
Dana S/N              = not assigned
```

The operator types the manufacturer S/N. Cutter build numbers created during this period use the manufacturer S/N in the cutter-body portion.

After etching, the Dana S/N is added to the **same cutter-body record**. New build numbers use the Dana S/N. Old builds are not renamed and remain attached to the same cutter body through its database UUID, preserving the complete history across the transition.

After etching, either identifier can still locate the body, but Dana is the preferred scanned identifier.

### Assigning Dana after etching

An unetched cutter can be created and used with only its MF/manufacturer serial. When that physical cutter is later etched, select the same cutter body by MF S/N and use **Assign etched Dana S/N**.

MeshForge updates the existing cutter-body row; it does not create a replacement cutter. Older MF-based build numbers remain unchanged and all previous builds/events remain connected through the same cutter-body UUID. New builds use the Dana S/N.


### MF-to-Dana assignment test

The master runner now includes a dedicated test for the unetched-to-etched cutter transition.

Safe/preflight mode:

```powershell
npm run test:meshforge
```

The MF-to-Dana test authenticates and verifies its harness without changing the database.

During the normal automatic master test, the harness creates dedicated `E2E-MF-*` cutter bodies and verifies the complete transition:

1. create an MF-only unetched cutter body;
2. find it by MF S/N;
3. assign a new Dana S/N to that same cutter-body UUID;
4. find the same body by Dana S/N;
5. confirm MF lookup still returns that same body;
6. attempt to assign that Dana S/N to a second body and require HTTP 409;
7. verify the failed duplicate attempt did not change either cutter.

The E2E cutter-body records are intentionally retained as traceable test records.

To skip only this transition test:

```powershell
.\tools\manufacturing\run-all-tests.ps1 -SkipCutterBodyTransition
```


## Fresh all-data migration from SQL Server

The canonical migration path is now the **fresh all-data import**. It combines the live legacy SQL Server source with the cleaned Excel reference package in one controlled workflow.

Safe preflight:

```powershell
npm run import:all-fresh
```

This reads SQL Server only, creates fresh base/reference and cutter-history snapshots, merges the cleaned Excel-derived reference files, and validates the combined source package. It does **not** change PostgreSQL.

Apply after the preflight passes:

```powershell
npm run import:all-fresh:apply
```

The apply sequence is:

1. Freshly export departments, employees, machines, models, summaries, gears, pinions, and pull reasons from SQL Server.
2. Merge the cleaned Excel-derived `summary_additions`, `cutter_blade_requirements`, `cutter_body_definitions`, and `cutter_bodies` data.
3. Import/upsert the combined base/reference data into PostgreSQL.
4. Freshly export cutter builds, central cutter log, setups, frequency checks, retired/pull history, pull reasons, and machine references from SQL Server.
5. Dry-run the history importer **after** the fresh base/reference import so all new summaries and part-type requirements exist.
6. If reconciliation passes, refresh cutter history transactionally from that exact fresh SQL Server snapshot.

The SQL Server source is never modified.

The fresh export snapshots are retained under `tools/manufacturing/data-import/work/` so the migration can be audited against exactly what was read from SQL Server.

### Excel-derived data included in the migration

The following files are authoritative supplemental reference data derived from the cleaned workbook:

```text
tools/manufacturing/base-data/data/summary_additions.json
tools/manufacturing/base-data/data/cutter_blade_requirements.json
tools/manufacturing/base-data/data/cutter_body_definitions.json
tools/manufacturing/base-data/data/cutter_bodies.json
```

The source workbook remains:

```text
tools/manufacturing/base-data/source/cutter-body-info-BASE-DATA-READY.xlsx
```

The fresh migration records the workbook SHA-256 and supplemental row counts alongside the SQL Server export.

### Cutter-body identity during history migration

The history refresh **does not delete physical cutter-body records**. Existing Excel MFâ†”Dana mappings and cutter definitions remain attached to the same cutter-body UUID.

Legacy cutter identifiers are matched case-insensitively against both `mf_serial_number` and `dana_serial_number`. If a legacy history row references a cutter not already known from the Excel reference set, MeshForge creates it as an **MF-only** cutter body. It never invents a Dana S/N.

This keeps pre-etch and post-etch history attached to the same physical cutter when the mapping is known.


## MeshForge Command Center

Both `commands\SETUP-MESHFORGE.cmd` and `commands\START-MESHFORGE.cmd` now display the current MeshForge command list when they finish.

You can display the same command list at any time with:

```powershell
npm run commands:meshforge
```

Setup automatically runs the safe `validate:base-data` and `test:data-import` checks unless `-SkipDataValidation` is supplied. Setup does **not** automatically apply database imports.

To make setup also perform the read-only fresh SQL Server + Excel import preflight:

```powershell
.\tools\manufacturing\setup-meshforge.ps1 -RunFreshImportPreflight
```

Startup does not run data validation by default because it is intended to launch quickly. To validate base/import contracts before starting:

```powershell
.\tools\manufacturing\start-meshforge.ps1 -ValidateData
```

The destructive/apply migration command `npm run import:all-fresh:apply` is intentionally displayed but never run automatically by Setup or Start.


### Blade-requirement summary bootstrap

The cleaned Excel blade-requirement data is authoritative for its Summary + Revision keys. Before importing `cutter_blade_requirements`, the base importer now upserts **every unique summary/revision referenced by the blade-requirement file** into `part_summaries`.

This prevents a fresh migration from failing when a valid Excel summary is absent from the legacy SQL Server `tblSUMMARY` table. For example, Summary `30135` is present in the blade-requirement data and is guaranteed to exist before its RING/PINION requirements are inserted.

The summary is created active/enabled with no model/HoS when the old database has no richer record. It can be disabled or enriched later without deleting its blade-requirement history.

### Legacy placeholder cutter identifiers

Legacy history values such as `NA`, `N/A`, `UNKNOWN`, or `UNASSIGNED` are not treated as real cutter serial numbers. Each affected historical build receives a traceable `LEGACY-UNKNOWN-*` MF identity so unrelated builds are never accidentally merged onto one physical cutter body. The original placeholder remains documented in the migrated cutter description.

### Blade-requirement revision matching

Blade requirements from the cleaned workbook currently use Summary number with a blank revision. If the fresh SQL Server data already contains exactly one revision for that Summary, MeshForge attaches the blade requirement to that existing revision rather than creating a duplicate blank-revision summary. For example, the packaged legacy snapshot contains Summary `30135` revision `B`, so the Excel requirement for `30135` resolves to that existing `B` summary.

If no summary exists, a blank-revision summary is created. If more than one enabled revision exists and Excel does not specify which revision, the import stops instead of guessing.

### Legacy orphan archive

Legacy source detail rows that cannot be safely attached to an operational cutter event are not discarded. They are retained verbatim in `cutter-history-legacy-orphans.json`, written beside `cutter-history-dynamic-migration-report.json` on every run, with their source type, Check_ID/Build_ID when available, reason they could not be linked, and the original JSON payload. This preserves source data without inventing a relationship that the legacy database does not prove.

### Orphan build rows are archive-only

If a legacy cutter-build row has no exact `CB + Check_ID` relationship in the central log, MeshForge does not invent a build number or operational history. The source row is preserved in `cutter-history-legacy-orphans.json`, but **no `cutter_builds`, `cutter_events`, setup/frequency/pull events, or machine-run records are created for it**. This is the rule used for legacy Check_ID `278` in the current source report.

### Duplicate central-log rows

Duplicate `ToC_ID + Check_ID` rows are collapsed only when all business fields (`Build_ID`, `Part_Count`, `Emp_ID`, `Date`, etc.) are identical. Different `Log_ID` values alone do not make them different business events. If any business field conflicts, the migration stops and reports the rows instead of choosing one.

### Central Log repeat-insert reconciliation

The legacy SQL Server can contain repeated Central Log inserts for the same `ToC_ID + Check_ID`. MeshForge treats that pair as one logical source operation.

If `Build_ID`, `Part_Count`, and `Emp_ID` agree, timestamp/Log_ID differences are treated as repeat inserts: the earliest row is used for the migrated event and every extra source row is archived in `cutter-history-legacy-orphans.json` as `CENTRAL_LOG_DUPLICATE`. The duplicates do not create extra work/events/logs.

If `Build_ID`, `Part_Count`, or `Emp_ID` disagree, the migration still stops because that is a genuine ambiguous source conflict.

### Legacy cutter bodies with unknown MF serials

New cutter bodies still require an MF/manufacturer serial. Historical cutter bodies imported from the old SQL Server may have no recorded MF serial, so the persisted/read model permits `mf_serial_number = null`. This prevents TypeORM startup synchronization from failing on valid historical rows. The create DTO still requires MF for every newly created cutter.

### Shelf-tag assertion regression

PowerShell variable names are case-insensitive. The previous workflow test accidentally reused `greenshedShelf` for both the expected part-specific `GSR-<summary>` / `GSP-<summary>` tag and the returned shelf object. The response object is now stored as `greenshedShelfLocation`, and the test compares its `serial_number` to the expected tag.

### Fully automatic master test

`npm run test:meshforge` requires no typed workflow inputs in normal mode. The harness creates/reuses dedicated E2E test account, cutter body, PINION/RING-compatible machine, matching part, trays, container, shelves and blades, and selects valid pull reasons automatically. It also provisions opposite-type part and machine fixtures so the compatibility rejection paths are tested.

The test does not The automated workflow uses a dedicated E2E Green Shed machine and does not use production machines. Manual fixture values are reserved for explicit `-NoAutoTestData` diagnostics.

### PINION/RING setup protection

Green Shed setup validates both the part number and machine against the cutter build. A part must match the build Summary and Part Type. PINION builds reject RING part numbers; RING builds reject PINION part numbers. PINION builds run only on machines in `PINION CUTTING`; RING builds run only on machines in `GEAR CUTTING`. These rules are enforced by the API and exercised by the automatic workflow test.

For the current run procedure and compatibility matrix, see `docs/manufacturing/TESTING.md`.

## Clean dependency installation

Run `commands\SETUP-MESHFORGE.cmd` once after extracting a new package. Setup deletes any previous `node_modules` and `.nx` cache, verifies npm's cache, installs exactly from `package-lock.json` with `npm ci`, and syntax-checks the installed Nx plugin worker before continuing.

Do not copy `node_modules` between MeshForge folders. The launcher uses the official Nx setting `NX_ISOLATE_PLUGINS=false` together with `NX_DAEMON=false` for deterministic Windows startup. `commands\START-MESHFORGE.cmd` also refuses to start if the Nx installation is missing or corrupted.

### npm/Husky warnings during Setup

A downloaded ZIP is not a Git repository, so Husky may print `fatal: not a git repository` / `git command not found, skipping install` during `npm ci`. That message is non-fatal for MeshForge and does not mean dependency installation failed.

If the Nx integrity check fails, Setup waits for npm lifecycle processes and Windows file handles to close, then retries removal of `node_modules` multiple times with both PowerShell and Windows `rmdir`. Setup will never continue using a partially deleted dependency tree.

### Nx integrity check

Setup validates the installed Nx runtime in two direct ways: `node --check` on Nx's `plugin-worker.js`, followed by `npx --no-install nx --version`. A package-lock JSON comparison is not used as a health gate because it can reject a valid installation even when the actual worker and CLI are healthy.

### Authenticated backend mutations

No separate command is required in the normal test run. `npm run test:meshforge` automatically provisions dedicated `E2E-*` backend-mutation fixtures, runs authenticated CRUD/negative/rollback/concurrency tests, performs safe cleanup, and then continues into the already-proven cutter-body and full manufacturing workflow tests. No production serials, machine numbers, part numbers, or credentials are entered manually.

### Faster dependency setup

Use `commands\SETUP-MESHFORGE.cmd` for normal setup. It validates an existing `node_modules`, then checks a shared MeshForge dependency cache keyed by the exact `package-lock.json` SHA-256, Node ABI, platform, and architecture. A verified cache is reused through a Windows junction, allowing later fresh folders with the same dependency lock to skip `npm ci`.

If no valid cache exists, setup runs `npm ci --prefer-offline --no-audit --no-fund`, verifies Nx, and publishes the verified dependency tree for reuse. Use `CLEAN-commands\SETUP-MESHFORGE.cmd` only for deliberate clean recovery.

### Admin screen

Open `/admin` from any MeshForge frontend while signed in with an admin-role account. The shared screen creates and lists Users, Part Summaries, Models, Machines, and Cutter Bodies. The Admin navigation item is hidden for non-admin users.

Local development provides a dedicated admin account: `admin@meshforge.local` / `MeshForge-Admin-Only-2026!`. The normal `test@meshforge.local` account intentionally remains a non-admin operator so authorization tests continue to exercise 403 behavior.

### Cutter Body administration

Cutter Body creation and Dana serial assignment are admin-only operations under `/admin` â†’ `Cutter Bodies`. Cutter Builder retains read/scan access so operators can build with existing Cutter Bodies, including MF-only bodies that have not yet been etched.

The master test now includes an Admin backend consistency contract and a runtime check that a non-admin account receives `403` when attempting Cutter Body creation.

### Department access

Normal users can view every app dashboard, but operational editing is department-scoped:

- CUTTER GRIND (`45`) edits Blade Tracking and Cutter Builder.
- GEAR QUALITY (`48`) edits Greenshed.
- Admin accounts bypass department restrictions.

When a user opens an app owned by another department, the sidebar shows `VIEW ONLY`, operational links/search are hidden, and protected deep links return to the dashboard. The API separately returns `403` for cross-department write attempts.

If you change a user's department or upgrade from an older package that did not include department claims in the JWT, sign out and sign back in so the frontend receives the current department claim.

### True full data refresh (delete old target data)

`npm run import:all-fresh:apply` is an update/reconciliation import; it does **not** guarantee that every stale target-only row is removed.

For a true clean refresh, close the running MeshForge API/server windows and run `commands\RESET-AND-REFRESH-ALL-DATA.cmd` from the project root. The launcher requires the exact confirmation phrase `DELETE OLD DATA` before it can delete anything.

The workflow is intentionally ordered for safety:

1. Read fresh base/reference data and cutter history from SQL Server and validate it first. SQL Server is never modified.
2. Only after preflight passes, truncate the MeshForge application rows in the PostgreSQL target configured in `.env`; the schema is preserved.
3. Import the already-validated fresh base/reference + Excel supplemental data.
4. Reconcile and import fresh cutter history.
5. Recreate the local operator/admin test accounts with their department assignments.
6. Run final validation.

A row-count audit of the target immediately before deletion is written to `tools/manufacturing/data-import/work/pre-reset-target-manifest.json`. This is a count manifest, not a backup of the old rows.

Safe preflight only (does not delete PostgreSQL):

`npm run refresh:all-data:reset`

Destructive CLI form after reviewing the preflight:

`npm run refresh:all-data:reset -- -Apply -YesReallyDeleteOldData`

After the refresh completes, start the apps normally with `commands\START-MESHFORGE.cmd` and sign in again.


### Clear operational data, keep users and base data

To start the floor over without reloading from SQL Server, close the running MeshForge API/server windows and run `commands\CLEAR-OPERATIONAL-DATA.cmd` from the project root. It first asks what to do with locations, lists what will be emptied and kept, then requires the exact phrase `CLEAR DATA`.

- **Emptied:** blades, trays, containers and the ground blade sets packed in them, cutter builds with their events, checks, teardowns and machine runs, coater shipments and RPA requests, Greenshed shift counts, DSF run state and the Cancel Last journal.
- **Also emptied:** any other table that points at those, directly or through another table, found from the database's own foreign keys. These are usually tables left by older releases (for example `dana_coater_blade_sets_v147`, `dana_coater_set_blades_v147`); the preview lists them with their row counts.
- **Locations**, chosen when the command starts (or with `--locations=`):
  - `keep-shelves` (option 1, the default): shelf/layer/bin locations (the Cuttergrind shelf bins such as `CGDR-A1A`, `CGFP-B3C` or `CGRR-A1A` that **Admin > Locations > Bulk shelf locations** makes) and `COATER-STAGING` are kept, with nothing on them. Every other location is deleted, including older numbered (`CGDR-001`) and Summary (`GSR-1010`, `CGDR-1010`) shelf tags.
  - `delete-all` (option 2): every location is deleted. The API recreates `COATER-STAGING` when it next starts; make the shelves again in **Admin > Locations > Bulk shelf locations**.
- **Kept:** users, departments, models, parts, part summaries, blade requirements, Summary Body Size Rules, cutter body definitions, cutter bodies, roll masters, gearsets, machines, lookup lists (part types, tray stages, statuses, event types, pull reasons, check results), server settings, label printers, Coater RPA setup, DSF machine mappings, all Lapper data, and every other table that does not point at operational data.

The preview stops, deleting nothing, if a kept table (or one outside the `public` schema) points at operational data, or if rows in a table that is not emptied point at a location that would be deleted; it names them. Everything runs in one transaction without `CASCADE`: on any error nothing is deleted. The command also stops, deleting nothing, if the API still has the tables in use. Row counts from just before the clear are written to `tools/manufacturing/data-import/work/pre-clear-operational-data-manifest.json` (counts only, not a backup).

Preview only: `npm run clear:operational-data`. Apply: `npm run clear:operational-data:apply`. Add `-- --locations=delete-all` to either to delete every location.

On the Linux Docker host, run `bash commands/CLEAR-OPERATIONAL-DATA.sh` from the release folder (`~/dana-apps`); it asks the same question, backs up the database first, and accepts `--locations=keep-shelves` or `--locations=delete-all`. See "Clear operational data" in `DOCKER.md`.

Afterwards make trays and containers again in **Admin > Launch Setup**, and any other locations you still need in **Admin > Locations**.

## Configure the IPL label printer

Run `commands\CONFIGURE-MESHFORGE-LABEL-PRINTER.cmd`, enter the printer IP address or hostname, and then restart `commands\START-MESHFORGE.cmd`. The helper updates only the three `GEAR_LABEL_PRINTER_*` values in `.env` and does not send a test label. If no printer is configured, Print Tag still downloads a native `.prn` file.


## Admin per-record asset tag printing

The shared `/admin` page includes Trays, Containers, and Locations for label printing. Each active row has its own **Print Tag** button. The browser sends the record UUID, and the backend reloads the row so the barcode/text always use the actual `serial_number` stored in the database. Tray/Container serials use the canonical `T0001` / `C0001` pattern.

All three tag types use 2.125 in x 0.625 in labels on 2.25 in web stock with 0.125 in physical gap above and below.

