# GearApps

Dana gear-manufacturing plant-floor apps. This Nx monorepo currently holds the **Lapper** app (gear lapping cells, lapping summaries, cutter tracking); Blade Tracking and Cutter Builder slot in alongside it as further `apps/` + `libs/` pairs.

| App             | Stack                                         | Path                 |
| --------------- | --------------------------------------------- | -------------------- |
| `lapper-client` | Angular 20 · [Dana UI](vendor/dana-ui)        | `apps/lapper-client` |
| `lapper-api`    | NestJS 11 · TypeORM 1.x · SQL Server / SQLite | `apps/lapper-api`    |

## Quick start

```sh
nvm use                      # Node 22
npm ci
cp .env.example .env         # defaults to a local SQLite database, no setup needed
npx nx serve lapper-api      # http://localhost:3333/api/v1  ·  Swagger: /api/docs
npx nx serve lapper-client   # http://localhost:4200  (proxies /api to the API)
```

Register the first account at `/register`, then sign in.

Set `DATABASE_TYPE` to `postgres`, `mssql` or `better-sqlite3` and the matching `DATABASE_*` values in `.env` (see `.env.example`). `docker compose --profile postgres up` starts a local Postgres 16. Keep `DATABASE_SYNCHRONIZE=false` against a shared database and manage schema changes deliberately.

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
