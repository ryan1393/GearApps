# GearApps

Dana gear-manufacturing plant-floor apps. The root Nx workspace holds **Lapper**.
The recovered **Blade Tracking, Cutter Builder, and Greenshed** release lives in
[`manufacturing/`](manufacturing/README.md) with its own pinned build system.

| App             | Stack                                         | Path                 |
| --------------- | --------------------------------------------- | -------------------- |
| `lapper-client` | Angular 20 · [Dana UI](vendor/dana-ui)        | `apps/lapper-client` |
| `lapper-api`    | NestJS 11 · TypeORM 1.x · SQL Server / SQLite | `apps/lapper-api`    |

## Manufacturing workspace

The uploaded GearApps 70.2.0 release has been restored and hardened as 70.2.1 under
`manufacturing/`. It contains three Angular 19 applications, their NestJS 10 API,
PostgreSQL schema/bootstrap, deployment tools, and regression tests. Its dependencies
and Nx targets are separate from Lapper's newer framework versions; root targets
continue to build Lapper. Run manufacturing commands from that directory:

```sh
cd manufacturing
npm install --global npm@11.6.2
npm ci
npm test
npm run test:contracts
```

See the manufacturing README and changelog for PostgreSQL/Docker setup, environment
settings, and upgrade notes. Default API/UI ports overlap with Lapper's development
defaults; use separate hosts or configure ports before running both stacks together.
Existing manufacturing users must sign in again after the authentication upgrade.
Email recovery requires SMTP and the public frontend origin to be configured.

Download the rebuilt standalone release: [GearApps 70.2.1 ZIP](releases/GearApps-70.2.1.zip).

The original upload is retained at
[`source-archives/GearApps-70.2.0.zip`](source-archives/GearApps-70.2.0.zip) for recovery.
The root Lapper API paths, source, and database configuration are preserved.

## Quick start

```sh
nvm use                      # Node 22
npm ci
cp .env.example .env         # defaults to a local SQLite database, no setup needed
npx nx serve lapper-api      # http://localhost:3333/api/v1  ·  Swagger: /api/docs
npx nx serve lapper-client   # http://localhost:4200  (proxies /api to the API)
```

Register the first account at `/register`, then sign in.

To run against the plant SQL Server set `DATABASE_TYPE=mssql` and the `DATABASE_*` values in `.env` (see `.env.example`). Keep `DATABASE_SYNCHRONIZE=false` against a shared database and manage schema changes deliberately.

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
  client/core            API clients, auth, layout prefs, toast, `loadable()` signal helper
  client/ui              Small Dana-styled building blocks (dialog, badge, value field, segmented)
  client/shell           Dana app shell: sidebar, topbar, health pill
  client/feature-*       One lib per screen area
vendor/dana-ui/          Pinned @dana/ui package (same mechanism as Truck Log)
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

## Upgrading Dana UI

Drop the new `dana-ui-x.y.z.tgz` into `vendor/dana-ui/`, update the `@dana/ui` entry in `package.json`, run `npm install`.
