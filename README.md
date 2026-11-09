# GearApps 70.3.0

Dana gear-manufacturing plant-floor apps: **Lapper, Blade Tracking, Cutter Builder, and Greenshed**.

| App             | Stack                                       | Path                 |
| --------------- | ------------------------------------------- | -------------------- |
| `lapper-client` | Angular 20 · [Dana UI](vendor/dana-ui)      | `apps/lapper-client` |
| `lapper-api`    | NestJS 11 · TypeORM 1.x · shared PostgreSQL | `apps/lapper-api`    |
| `lapper-read`   | .NET 8 Windows worker · FANUC / TCP scanner | `apps/lapper-read`   |

## Lapper Read collector

The Windows collector lives beside the Lapper API and client in
[`apps/lapper-read`](apps/lapper-read/SETUP.txt). It captures scanned serials,
machine cycles and macro snapshots, with disk checkpoints and retryable API writes.
It has its own .NET solution and regression suite, separate from the Nx targets:

```sh
dotnet build apps/lapper-read/LapperRead.sln -c Release
dotnet test apps/lapper-read/LapperRead.Tests/LapperRead.Tests.csproj -c Release
```

See its setup notes for service credentials, the licensed FANUC DLLs, writable
checkpoint storage, and the API idempotency requirement. The collector has a
dedicated Windows CI workflow. Its release metadata inherits 70.3.0 through
Directory.Build.props; its functional source is preserved.

## One shared workspace

GearApps **70.3.0** contains Lapper, Blade Tracking, Cutter Builder, and Greenshed
in one Nx workspace. Install dependencies once, at this repository root.
All applications share Angular 20.3.35, NestJS 11.2.9, TypeORM 1.1.2, Nx 24.0.5,
TypeScript 5.9.3, Jest 30, and Dana UI 0.3.3. The root package.json and package-lock.json
are the dependency authority; manufacturing/ contains application sources and tools.

```sh
nvm use                         # Node 24.22.1
npm install --global npm@11.9.0
npm ci
npm run test:versions
npm test
npm run test:contracts
npm run lint
npm run build
npm run package:release          # full source ZIP + SHA-256 checksum
```

Manufacturing setup, PostgreSQL configuration, and production deployment are documented
in [manufacturing/README.md](manufacturing/README.md). Run npm and Nx commands at the
repository root. The two APIs retain their existing routes and database configuration.
Lapper uses API port 3334 and UI port 4203; manufacturing retains API port 3333
and client ports 4200–4202. See [Lapper PostgreSQL setup](docs/LAPPER_POSTGRES.md)
for the shared database, collector setup, and existing-history import.

All four clients consume the same [Dana UI source](libs/shared/dana-ui). Its build
updates the root vendor package used for published styles. No separate Dana UI install
is required. Update dependency versions in the root manifest, regenerate the root lock,
and run the version check and full validation before publishing.

Download the complete workspace: [GearApps 70.3.0 ZIP](releases/GearApps-70.3.0.zip).
Validation details are in [the release report](docs/RELEASE_VERIFICATION_70.3.0.json).
Previous releases and the original upload remain in releases/ and source-archives/
as historical archives.

## Quick start

```sh
nvm use                      # Node 24.22.1
npm ci
cp .env.example .env         # set the existing GearApps PostgreSQL credentials and JWT_SECRET
npx nx serve lapper-api      # http://localhost:3334/api/v1  ·  Swagger: /api/docs
npx nx serve lapper-client   # http://localhost:4203  (proxies /api to Lapper API)
```

Sign in with an existing active GearApps account. Account management stays in
GearApps; PostgreSQL mode disables Lapper registration.

For the combined Docker deployment, configure `manufacturing/.env` and run
`docker compose --env-file manufacturing/.env -f manufacturing/compose.yml up -d --build`.
Lapper and the manufacturing apps use the same `dana-postgres` service and `GEAR_DB_NAME`.
The legacy standalone SQLite/SQL Server backends remain selectable explicitly.

## Features (Lapper)

- **Cell dashboard** — machines grouped by lapping cell; per-cell live view with the scanner's latest capture, in-scanner / in-queue / in-process serial numbers, Fanuc I/O (door, cycle) and scanner op-code controls. Polling pauses when the tab is hidden.
- **Lapping summaries** — pick a gearset and a machine (each list narrows to combinations that have actually run) and see the latest value of every Fanuc macro, grouped exactly like the machine's forms: gearset data, general data, meshing position, and the active lapping paths (coast / drive / tip / root).
- **Master data** — machines, parts (pinions & rings), gearsets (ratio auto-calculated from teeth), part summaries. Tables sort and filter per column (Dana UI).
- **Cutter tracking API** — logs, builds, CMM and frequency checks, pull-cutter reasons, retired cutters (API only; the Cutter Tracking screens live in their own app).

## Workspace layout

```
apps/
  lapper-api/            NestJS entry: config, health, Swagger
  lapper-client/         Angular entry: routes, Dana UI stylesheet
libs/
  shared/domain          Interfaces shared by API and client (one source of truth)
  api/core               Config + validation, JWT guard, DB exception filter, generic CRUD base
  api/data-access        TypeORM entity schemas + DTOs (class-validator / Swagger)
  api/feature-auth       Users, login, JWT strategy
  api/feature-gear       Machines, gearsets, parts, summaries, cycles, macros, macro logs, scanners, Fanuc I/O
  api/feature-cutter-tracking
  api/feature-scanner    Scanner HTTP + FTP integration (hosts & credentials from env)
  api/postgres           Shared GearApps catalog/auth + additive Lapper history store
  client/core            API clients, auth, layout prefs, toast, `loadable()` signal helper
  client/ui              Small Dana-styled building blocks (dialog, badge, value field, segmented)
  client/shell           Dana app shell: sidebar, topbar, health pill
  client/feature-*       One lib per screen area
  shared/dana-ui/        Canonical Dana UI source and compatibility styles
manufacturing/          Blade Tracking, Cutter Builder, Greenshed, and PostgreSQL API
vendor/dana-ui/package/ Generated @dana/ui package shared by all clients
```

### Conventions

- **Dana UI first.** Screens are built from `@dana/ui` classes and directives (`.dana-panel`, `table[danaTable]`, `dana-combobox`, `dana-confirm-dialog`, …). App CSS only adds layout.
- **API routes are stable.** Paths match the original Lapper API (`/api/v1/machine`, `/macro-log`, `/scanner-detail/…`) so PLC/scanner collectors keep working; new routes are additive (e.g. `GET /macro-log/summary/:machineId/:gearsetId?form=`).
- **Every entity is `BaseCrudService` + `crudController()`**; only bespoke queries live in feature code.
- **Secrets and hosts come from `.env`** — nothing is hard-coded (scanner IPs, FTP credentials, JWT secret).

## Useful commands

```sh
npx nx run-many -t lint test build      # what CI runs
npx nx graph                            # project graph
npx nx g @nx/angular:library libs/client/feature-x --standalone   # new screen area
docker compose up --build               # client on :8080, API behind nginx at /api
```
