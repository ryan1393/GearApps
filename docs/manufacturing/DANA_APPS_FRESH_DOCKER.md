# Dana Apps — Fresh Docker Host

The consolidated Gear Apps workspace supports a brand-new Docker host without requiring a pre-existing Gear PostgreSQL volume.

## Safety model

- Every application uses the shared GearApps PostgreSQL database and named volume.
- Lapper history is linked to the shared masters through the `lapper` schema.
- Runtime Gear API always starts with `DATABASE_SYNCHRONIZE=false`.
- The one-shot `gear-db-bootstrap` service may enable TypeORM synchronize **only when the Gear database has zero public tables**.
- A non-empty partial schema is refused rather than auto-repaired.
- The one-shot bootstrap verifies representative Gear tables after schema creation.
- `gear-base-data-bootstrap` runs the maintained importer with `--bootstrap-only`, initializing an empty master-data set while preserving administrative edits on subsequent deployments.
- Explicit `npm run import:base-data` still refreshes existing reference data and must be an intentional operator action.
- Existing Gear volumes are never automatically deleted by the fresh-host helper.

## Required .env values

Keep the existing repository root `.env`. On a new host, copy the root
`.env.example` to `.env` and set real values for at least:

- `GEAR_DB_PASSWORD` (12+ characters)
- `SEED_ADMIN_PASSWORD` (12+ characters)
- `SEED_USER_PASSWORD` (12+ characters)
- `JWT_ACCESS_SECRET` (32+ random characters recommended)
- `JWT_REFRESH_SECRET` (32+ random characters recommended)

Do not leave the `replace-*` placeholders in place.

Fresh seed logins are:

- `admin@example.com` using `SEED_ADMIN_PASSWORD`
- `user@example.com` using `SEED_USER_PASSWORD`

## Fresh-host deployment

From the Linux Docker host, in the Dana Apps root:

```bash
chmod +x commands/DANA-APPS-FRESH-DOCKER-UP.sh
./commands/DANA-APPS-FRESH-DOCKER-UP.sh
```

The helper validates secrets, validates Compose, builds all images, starts PostgreSQL, runs one-shot schema/user/reference bootstrap, imports base master data, starts the runtime API, waits for `/api/v1/health/ready`, then starts all four web clients.

## Default ports

- Blade Tracking: 4200
- Cutter Builder: 4201
- Greenshed: 4202
- Lapper: 4203
- Gear API: 3333
- Gear PostgreSQL: 5432

## Docker volume

Default Gear volume name:

`dana-apps-gear-postgres`

Override with `DANA_POSTGRES_VOLUME_NAME` in `.env` when needed.

## Windows-to-Docker transfer

From the repository root, `commands\TRANSFER-DANA-APPS-TO-DOCKER.cmd` packages source without `node_modules`/archives/caches and copies it to the configured remote Docker host at `/tmp/dana-apps.v0.1` by default.

## Fresh DB runtime dependency boundary

The `gear-db-bootstrap` service runs from the same production-dependency image as the Gear API. Production seed/bootstrap code therefore must not import test-only/dev-only libraries.

`@ngneat/falso` remains a devDependency for unit tests, but `UserDatabaseSeedService` uses Node `crypto` for runtime-safe fallback/random seed values. The server Docker build scans `dist/apps/server-bootstrap/main.js` and fails immediately if `@ngneat/falso` is ever reintroduced into the bootstrap bundle.

## Password recovery and upgrades

An empty `SENTRY_DSN` disables optional reporting and is valid. Password recovery
requires working SMTP settings and `PUBLIC_WEB_BASE_URL` set to the public frontend
origin (Docker: `GEAR_PUBLIC_WEB_BASE_URL`). Use an HTTP(S) origin such as
`https://gear.example.com`; paths, query parameters, fragments, and credentials are
rejected. The default `http://localhost:4200` is for local development.

Startup adds nullable password-reset hash/expiry fields and an authentication version
to existing user tables using idempotent additive SQL. Existing application data is
preserved with synchronization disabled. Users sign in again and request fresh recovery
links after upgrading. Normal automatic redeployment skips the bundled reference-data
snapshot once master data exists; it does not undo disabled employees/machines or edited
roll-master minimum quantities.

## Consolidated workspace

All Docker contexts point to the repository root. Root `package.json` and
`package-lock.json` supply every app's dependencies; manufacturing has no separate
installation. Node is pinned to 24.22.1 and npm to 11.9.0. CI installs once at the root
and verifies all applications. The manufacturing stack can be managed from the root
with `docker compose --env-file .env -f compose.yml ...`.
Every application is under root `apps/` and uses the same API, database and root `.env`.
