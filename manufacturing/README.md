# Gear Apps 70.4.0

Gear Apps is the Dana manufacturing workspace for four workflows sharing one API and database:
**Blade Tracking**, **Cutter Builder**, **Green Shed** and **Lapper**. It belongs to the root GearApps Nx workspace. All frontends use
Angular 20.3.35 and Dana UI 0.3.3; the shared API uses NestJS 11.2.9 and TypeORM 1.1.2.
Manufacturing retains PostgreSQL 16 and Docker Compose.

| Service | Port | |
|---|---|---|
| Blade Tracking | 4200 | `../apps/blade-tracking` |
| Cutter Builder | 4201 | `../apps/cutter-builder` |
| Green Shed | 4202 | `../apps/greenshed` |
| Lapper | 4203 | `../apps/lapper-client` |
| Shared API | 3333 | `../apps/server` (`/api/v1`, health at `/api/v1/health/ready`) |

## What changed in 70.4.0

- **Label printers.** Admin > Label Printers holds the network label printers: address,
  language (IPL for Intermec, ZPL for Zebra), what each is loaded with, and the default for
  tags and for cutter cards. Print screens let a workstation choose its own printer. Tags and
  cutter cards are sent in the chosen printer's language. See
  [docs/printing/LABEL-PRINTERS.md](docs/printing/LABEL-PRINTERS.md).
- **DSF production counts** for cutting Departments 132 and 152, read-only from the Digital
  Shop Floor database and off by default. See [docs/DSF_COUNTS.md](docs/DSF_COUNTS.md).
- **Workflow and UI review** of every scan screen, dashboard and Admin tab, and a fix for
  creating trays. Details are in [CHANGELOG.md](CHANGELOG.md).

Two tables are added at API startup when missing: `gear_label_printers`, and the DSF side
tables when the DSF reader is switched on. No existing table or data is changed.

## What changed in 70.3.0

Lapper, Blade Tracking, Cutter Builder, and Greenshed now share one root dependency
manifest, lockfile, Nx graph, and Dana UI source. The root runtime is Node 24.22.1
with npm 11.9.0. Run npm and Nx commands from the repository root; do not install
dependencies inside manufacturing/.

```sh
nvm use
npm ci
npm run test:versions
npm test
npm run test:contracts
npm run lint
npm run build
npx nx serve blade-tracking
```

The authentication, recovery, inventory, scanning, and deployment fixes from 70.2.1
are retained. API routes and PostgreSQL workflow rules remain compatible. All four clients and Lapper Read use gear-app-server on port 3333. The only API
environment is .env. See [unified API setup](../docs/UNIFIED_API.md).

Users must sign in again after upgrading. Emailed recovery requires SMTP and the public
frontend origin (`PUBLIC_WEB_BASE_URL`, or Docker `GEAR_PUBLIC_WEB_BASE_URL`).

Portable checks: `npm test` runs isolated unit and deployment/configuration tests;
`npm run test:contracts` runs source contracts. Live workflow scripts require a dedicated
test database and explicit `GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES`.

## Earlier 70.1.0 improvements

Full detail is in `CHANGELOG.md`. In short:

- **One version everywhere.** `70.1.0` is in `package.json`, the API (`/api/v1/health/live`, Swagger),
  the sidebar footer of all three apps and the Docker image tags. Change it with
  `npm run version:set -- <x.y.z>`; `npm run test:version` checks it.
- **Startup deadlock fixed.** The API's startup schema routines could deadlock each other on
  `cutter_builds`. They now share one lock.
- **Pull reasons.** Every API restart re-created five generic pull reasons (DULL, DAMAGED, ...) that the
  base-data import removes, so they showed up next to Dana's `PCR_*` reasons. Fixed. The Running
  Machines *Changeover* shortcut now picks the configured return-to-shelf reason.
- **Security.** Test-fixture scripts that create known-password admin accounts now refuse to run
  unless the machine opts in. The deploy script refuses placeholder or short JWT secrets, and the
  API warns about them at startup.
- **New deploy** (`Deploy-GearApps.cmd`), see below.
- **UI fixes.** Intake focus after a tray scan, Summary and Part Type on the Internal Movement
  confirmation, Green Shed Setup on the shared workflow layout, garbled `â€”`/`â€¢` characters.
- **Code health.** All server libraries compile under their strict settings. All server unit tests
  pass. Read-side queries were split out of the three largest services. A schema drift check was
  added. Out-of-date tests were brought up to date.

## Deploy

Run deployment from the repository root with
`node manufacturing/tools/deploy/deploy-remote.mjs` (Windows:
`manufacturing\Deploy-GearApps.cmd`). The archive contains the single root workspace;
Docker builds use the root lockfile and pinned Node 24.22.1/npm 11.9.0. Manufacturing
configuration is the repository root `.env`, shared by every feature.
The deployer preserves that file and keeps the previous tree for rollback.
When upgrading an older split layout, it carries the former shared
`manufacturing/.env` into the repository root.


`Deploy-GearApps.cmd` (or `node manufacturing/tools/deploy/deploy-remote.mjs`) deploys the shared repository to the Linux
Docker host behind your active **SSH Docker context** (`docker context use <name>`). It needs `ssh`,
`scp`, `tar`, `docker`, Node 24.22.1 and npm 11.9.0 on the Windows machine.

1. **Preflight (changes nothing):** `Deploy-GearApps.cmd --check`. This checks the version, the SSH
   context, host Docker, and the host `.env` (JWT secrets 32+ random characters, no
   `GEAR_APPS_ALLOW_TEST_ACCOUNTS`; a short database password only warns, because Postgres must be
   changed first with `ALTER USER`).
2. **Deploy:** `Deploy-GearApps.cmd`. It:
   1. backs up the database with `pg_dump` to `~/dana-apps-backups/` on the host (owner-only files,
      newest 20 kept); a failed backup stops the deploy;
   2. copies the source to `~/dana-apps`, keeping the previous release in `~/dana-apps.prev`
      and the host's own `.env`;
   3. runs `docker compose build` and `up -d` (never `down`, never touches volumes);
   4. waits for every service and checks that the API reports `70.4.0`. Only then does the old
      release become `~/dana-apps.prev`. If the deploy fails, the last good release is protected
      (a retry discards the failed one) and `--rollback` brings it back.
3. **Rollback:** `Deploy-GearApps.cmd --rollback` swaps `~/dana-apps.prev` back in and restarts it.
   Schema changes in this app are additive, so the previous release runs against the current database.
   To restore data as well, load the backup taken before the deploy:
   `cd ~/dana-apps && gunzip -c ~/dana-apps-backups/<file>.sql.gz | docker compose --env-file .env -f compose.yml exec -T dana-postgres psql -U <GEAR_DB_USERNAME> -d GearApps`
   (restore into an emptied database).

**First 70.1.0 deploy:** earlier releases lived in `/tmp/dana-apps.v0.1` on the host, and most
Linux servers empty `/tmp` on reboot. The first deploy copies the host `.env` from there into
`~/dana-apps` automatically. The Compose project (`dana-apps`) and the database volume name stay the
same, so containers are recreated in place and **data carries over**. If the host `.env` still has
placeholder JWT secrets the deploy stops and tells you how to generate new ones (everyone is signed
out once; nothing else changes).

**Brand-new host:** put a filled-in `.env` (from `.env.example`) at the repository root and run
`Deploy-GearApps.cmd --upload-env`.

## Verify a database

- `npm run db:check-drift` (read-only) compares the entity definitions with any database named in
  `.env` and prints the SQL TypeORM *would* run. A fresh 70.1.0 install shows **no drift**. Run it
  against production after deploying to confirm the live schema matches.

## Tests

| Command | Needs | What it covers |
|---|---|---|
| `npm run test:contracts` | nothing | Source contracts: workflows, UI shell, styling, data rules |
| `npm run test:version` | nothing | One version across every place it is written |
| `npm test` | installed dependencies | Isolated unit/behavior and deployment/configuration tests |
| `npm run test:contracts` | installed dependencies | Portable source contracts |
| `npm run test:workflow` | API + **test** DB | 23-call end-to-end: grinding, coater shipment, build, setup, QC, changeover, teardown |
| `npm run test:gear-apps` | Windows PowerShell, API + test DB | Original master suite (see note below) |

Note: `tools/test-full-workflow.ps1` predates numbered Cuttergrind shelves, coater shipments and
Cutter Builder machines. `npm run test:workflow` is the current end-to-end path; the fixtures it
uses (`tools/test-data/ensure-workflow-test-fixtures.mjs`) were updated for all three.

## Start

After extracting the project, run `commands\SETUP-GEAR-APPS.cmd` once, then use `commands\START-GEAR-APPS.cmd` to start the API, Blade Tracking, Cutter Builder, and Green Shed.

## Test

Run the complete automatic test from the project root:

```powershell
npm run test:gear-apps
```

The normal master test requires no typed workflow inputs. It provisions dedicated E2E test data automatically. See `docs/TESTING.md` for the complete run procedure and the PINION/RING compatibility tests.

## Current manufacturing rules

- Dana serial number is the normal scanned cutter-body identifier after etching.
- An unetched cutter body may have only an MF/manufacturer serial number; MF lookup/manual entry remains supported until that body receives its Dana serial.
- Cutter build history remains attached to the same physical cutter body when the Dana serial is later assigned.
- A part number must match the cutter build Summary and Part Type.
- PINION build + RING part number is rejected.
- RING build + PINION part number is rejected.
- PINION builds run only on `PINION CUTTING` machines.
- RING builds run only on `GEAR CUTTING` machines.
- Green Shed shelves: `GSR-<summary>` for RING and `GSP-<summary>` for PINION.
- Cuttergrind shelves are **numbered** physical shelves configured in Admin: rough `CGRR-###` / `CGRP-###` (required when completing grinding of a full tray), dull `CGDR-###` / `CGDP-###`, finished `CGFR-###` / `CGFP-###` (RING / PINION). Summary-derived `CGD?-<summary>` / `CGF?-<summary>` tags are legacy and are rejected for placement.
- Coated trays reach the coater through a **Coater Shipment** (create, add containers, review, print, dispatch); loading a tray only marks it Packed for Coater.
- A cutter build records the Department 45 **Cutter Builder machine** that built it.
- Empty trays with 0 blades do **not** require a physical location. They remain `EMPTY`, unassigned, and are operator-visible as **Available / Ready to Use** until selected for a workflow such as Cutter Builder teardown.
- `Cuttergrind_Verified_Pull` is retired and is not part of current application logic or compatibility checks.

## Reference data

Base-data import includes departments, employees/users, machines, models, summaries, RING parts (legacy gears), PINION parts (legacy pinions), pull reasons, cutter-body definitions, cutter bodies, and Summary + Part Type blade requirements.

See `docs/MIGRATION.md` for migration behavior and `docs/SHELF_LOCATIONS.md` for shelf rules.

## Styling (Dana UI)

All visual styling comes from **@dana/ui** (Dana UI), the same package Truck Log uses. It is
vendored in `vendor/dana-ui/package` (see `VENDOR_MANIFEST.json` for version and checksums) and
installed as `node_modules/@dana/ui`.

Rules for this app:

- Do not add colors, fonts, shadows, or restyle buttons, tables or panels here.
- Build screens with Dana UI components and classes (`danaButton`, `danaTable`, `dana-panel`,
  `dana-page-header`, `danaDetailGrid`, ...), imported from `@dana/ui`.
- Layout for a single screen (grid, ordering, spacing between sections) is fine in the screen's
  own template.
- If something needs a new look or a new shared component, it belongs in Dana UI so Truck Log and
  Gear Apps both get it. Change Dana UI, release it, then update the vendored copy here.

Each app loads, in this order (`../apps/<app>/project.json`):

1. `../apps/<app>/src/styles.css`: Tailwind directives only
2. `@dana/ui/styles/gear-compat.css`: Gear's current shell, panels and primitives
3. `@dana/ui/styles/gear-compat-features.css`: Gear screen styles (dashboards, inventory, Running Machines...)
4. `@dana/ui/styles/dana-ui.css`: the shared Dana UI look (what Truck Log loads)
5. `@dana/ui/styles/gear-compat-overrides.css`: keeps Gear's current look where Dana UI differs

Files 2, 3 and 5 are a temporary compatibility layer that lives in Dana UI and only Gear loads.
They shrink as screens move to the shared look, and go away when that is done.
The Tailwind preset also comes from Dana UI (`@dana/ui/tailwind/tailwind-preset.cjs`), through
`tools/tailwind/create-app-tailwind-config.js`.

To update Dana UI: build the release in the Dana UI repo, replace `vendor/dana-ui/package` with its
`dist`, update `VENDOR_MANIFEST.json` and the `vendor/dana-ui/package` version in
`package-lock.json`, then run `npm install` and the tests.

## Admin management

The shared `/admin` screen is available in Blade Tracking, Cutter Builder, and Greenshed for admin-role accounts. It uses the same centralized Gear Apps design system and provides create/list workflows for:

- Users
- Part Summaries
- Parts
- Models
- Machines
- Cutter Bodies

The existing Users feature was retained as the admin route but rebuilt into the shared Gear Apps administration workspace. Part Summary and Cutter Body creation reuse their existing backend APIs. Admin-only master-data endpoints were added for Models, Machines, and Department lookup, and an admin-only `POST /api/v1/users` route was added so the selected User/Admin role is preserved.

For local development on a **test** database (its `.env` must contain `GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES`), `commands\START-GEAR-APPS.cmd` provisions:
- Operator: `test@gearapps.local` / `GearApps-E2E-Only-2026!`
- Admin: `admin@gearapps.local` / `GearApps-Admin-Only-2026!`

These passwords are published in this repository. The fixture scripts refuse to run without that opt-in, and the deploy script refuses a production `.env` that sets it.

### Admin-only Cutter Body management

Cutter Bodies are master data. Creation and Dana-serial assignment are available only from the shared `/admin` → `Cutter Bodies` screen and both mutation endpoints require the `admin` role.

Normal Cutter Builder operators can still scan/read a Cutter Body and use it in builds. They cannot create Cutter Bodies or assign/replace Dana serials from the Cutter Builder workflow.

All Admin UI HTTP calls are centralized in `libs/frontend/feature-admin-users/src/lib/admin-api.service.ts`. The Admin component no longer owns endpoint URLs directly.

## Department-scoped application access

Normal Gear Apps users are now department-scoped for operational editing. Cross-department users can open an application's dashboard, but the operational navigation/actions are shown as view-only and deep links redirect back to the dashboard. The backend independently rejects cross-department mutations with HTTP 403, so the rule cannot be bypassed by calling the API directly.

Current ownership is centralized in `libs/shared/util-constants/src/lib/app-access.constants.ts`:

- Department `45` — CUTTER GRIND: edit Blade Tracking and Cutter Builder.
- Department `48` — GEAR QUALITY: edit Greenshed.
- PINION CUTTING, GEAR CUTTING, MANAGEMENT, and any other normal-user department: dashboard-only in apps they do not own.
- Admin role: edit access across all apps regardless of department.

Department is required when an Admin creates a new user. Department claims are included in login/refresh tokens for the UI, while the backend reloads the current department from the database on authenticated requests.

The cross-app automatic E2E workflow intentionally runs as the dedicated Admin account because one normal department-scoped user should not be able to transact across all three applications.

## True target-data reset + fresh import

For a clean replacement of old PostgreSQL application data, use `commands\RESET-AND-REFRESH-ALL-DATA.cmd`. Unlike the normal fresh importer, this workflow intentionally deletes existing target application rows after a fresh SQL Server/Excel source snapshot has successfully exported and validated. The PostgreSQL schema is preserved; SQL Server remains read-only. The workflow then imports fresh base/reference data, fresh cutter history, and recreates the local development accounts.

### Full-reset system reference bootstrap

A full target reset also deletes database-backed system reference rows such as `RING` / `PINION` part types, tray stages, cutter statuses, event types, pull reasons, and check results. The reset workflow therefore restores those required system references immediately after the PostgreSQL truncate and before importing fresh base/reference data. This makes the reset independent of whether the Nest API is already running.

### Reusable T/C inventory with mock data

Every full data reset creates the reusable physical pool:

- 300 trays: `T0001` through `T0300`
- 100 containers: `C0001` through `C0100`

The reset then seeds a realistic mixed-data snapshot using the **real imported Summary / blade-requirement reference data**. It rotates RING and PINION requirements across different Summaries, creates populated trays, and distributes mock data through the available location workflow.

For a representative set of imported Summaries it creates the normal shelf convention (`CGDR-<Summary>` / `CGDP-<Summary>`, `CGFR-<Summary>` / `CGFP-<Summary>`, plus `GSR-<Summary>` / `GSP-<Summary>`). Dull Cutter Grind shelves receive `WAITING_FOR_GRINDING` trays, finished Cutter Grind shelves receive exact-count `READY_FOR_CUTTER` trays, and a small sample is loaded into `C0001...` containers in `AT_COATER` state.

Green Shed `GSR-<Summary>` / `GSP-<Summary>` shelves intentionally do **not** receive trays because the production application rejects trays on Green Shed cutter shelves. Those locations receive mock `SHELF` cutter builds instead, preserving the real business rule while still putting useful mock data at that location type.

Any other enabled tray-compatible locations are also given a populated mock tray. Remaining T/C records stay empty and available for normal workflow testing. The seed is transactional and refuses to overwrite an already-used managed T/C pool.

## Blade Locations + Admin Locations

Blade Tracking has a dedicated `/blades/locations` screen that loads all tagged locations and shows active tray placement at each location. Expanding a location shows its trays; expanding a tray shows the individual active blade assignments with blade serial, Summary, Part Type, status, and service cycle. Green Shed `GSR-<summary>` / `GSP-<summary>` cutter shelves remain visible for location awareness but are labeled as cutter shelves where generic tray placement is not allowed.

The shared `/admin` screen now includes a **Locations** tab. Admins can create, edit, enable, and disable location master records through the existing protected `/api/v1/locations` endpoints. `GSR-<summary>`, `GSP-<summary>`, `CGDR-<summary>`, `CGDP-<summary>`, `CGFR-<summary>`, and `CGFP-<summary>` tags derive their Summary/department/SHELF metadata from the shared shelf parser. All Summary-derived shelves are part-type-specific and require the matching RING/PINION Summary blade requirement. The API rejects identity/routing changes or disabling while active tray or cutter placements remain at that location.

That Blade Locations feature itself added no backend route. After the native asset-tag printing endpoint was added, the current API manifest is **113 routes**.



## Native IPL tags for trays, containers, and locations

Gear Apps can generate printer-native Intermec IPL tags from Find Inventory, the Inventory Control Center, Blade Locations, Tray Contents, and the shared `/admin` page. Admin has dedicated Tray and Container record tabs plus per-record Print Tag actions on Trays, Containers, and Locations.

Each tag contains one Code 128 barcode plus the same identifier in human-readable text. The browser sends only the database record ID; the backend reloads the record and prints its persisted `serial_number`. Tray tags therefore print the table's `T0001`-style serial, container tags the table's `C0001`-style serial, and location tags the exact stored location serial. New/edited Tray and Container serials are normalized to `T`/`C` plus at least four zero-padded digits.

The shared label stock is 2.25 in web width with a 2.125 in x 0.625 in label and 0.125 in physical gap above/below. The IPL format uses a 431 x 127 dot label face at the existing Intermec 203 dpi coordinate family.

The authenticated print endpoint is `POST /api/v1/asset-tags/print`. Run `commands\CONFIGURE-GEAR-APPS-LABEL-PRINTER.cmd` (or configure `GEAR_LABEL_PRINTER_HOST`) to send raw IPL directly to the industrial printer on `GEAR_LABEL_PRINTER_PORT` (default 9100). If no printer host is configured or the printer cannot be reached, the UI downloads the native `.prn` payload instead. No browser-rendered barcode is substituted.

See `docs/printing/ASSET-TAG-IPL.md`. The current API manifest is **113 routes**.

### Green Shed part-specific shelves

Green Shed intact-cutter locations are part-type-specific: `GSR-<summary>` for RING and `GSP-<summary>` for PINION. All Summary-derived shelf tags place a dash between the location type and Summary. Cuttergrind is also part-type-specific: RING uses `CGDR-` / `CGFR-`, PINION uses `CGDP-` / `CGFP-`. Empty/0-blade trays are not a Summary shelf category and do not need a location. During teardown, a tray only becomes Summary + Part Type specific if blades are returned; those returned blades require the matching `CGDR-` / `CGDP-` dull shelf. If every blade is scrapped, the tray returns to `EMPTY` with no active location assignment and is Available / Ready to Use. Existing development databases can be audited/migrated with `commands\MIGRATE-SUMMARY-SHELF-TAGS.cmd`. The launcher always runs a dry scan first, requires the exact confirmation phrase before applying, converts only safe rows, and leaves ambiguous rows for review. The equivalent npm commands are `npm run migrate:summary-shelves` and `npm run migrate:summary-shelves:apply`. The older Green Shed migration command remains as a compatibility alias.

