# Docker / Compose

Dana Apps uses one root `compose.yml`.

The current Gear domain stack contains:

- `dana-postgres` — PostgreSQL 16, host port 5432
- `gear-db-bootstrap` — one-shot fresh/verified schema + seed-user/reference bootstrap
- `gear-base-data-bootstrap` — one-shot idempotent base master-data import
- `gear-app-server` — NestJS API, host port 3333
- `blade-tracking` — Angular/Nginx, host port 4200
- `cutter-builder` — Angular/Nginx, host port 4201
- `greenshed` — Angular/Nginx, host port 4202

Truck Log will later join the same root Compose with a separate database/volume.

## Fresh Docker host

Copy `.env.example` to `.env` and replace the required DB/JWT/seed password placeholders. Then run on the Linux Docker host:

```bash
chmod +x DANA-APPS-FRESH-DOCKER-UP.sh
./DANA-APPS-FRESH-DOCKER-UP.sh
```

The helper validates Compose, builds images, starts PostgreSQL, initializes an empty Gear schema once, seeds the required login/reference data, imports maintained base master data, starts the runtime API with `DATABASE_SYNCHRONIZE=false`, waits for the ready endpoint, and reports the final service state.

The helper never deletes an existing Gear volume automatically.

## Normal commands

```bash
docker compose -f compose.yml config
docker compose -f compose.yml build --progress=plain
docker compose -f compose.yml up -d
docker compose -f compose.yml ps
docker compose -f compose.yml logs -f
docker compose -f compose.yml down
```

Or from npm scripts:

```text
npm run docker:config
npm run docker:build
npm run docker:up
npm run docker:ps
npm run docker:logs
npm run docker:down
```

API readiness:

```text
http://localhost:3333/api/v1/health/ready
```

PostgreSQL data is persisted in the named volume from `DANA_POSTGRES_VOLUME_NAME` (default `dana-apps-gear-postgres`).
