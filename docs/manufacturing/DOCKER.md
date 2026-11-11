# Docker / Compose

Dana Apps uses one root `compose.yml`.

The current Gear domain stack contains:

- `dana-postgres` — PostgreSQL 16, host port 5432
- `gear-db-bootstrap` — one-shot fresh/verified schema + seed-user/reference bootstrap
- `gear-base-data-bootstrap` — one-shot idempotent base master-data import
- `meshforge-server` — NestJS API, host port 3333
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

## Clear operational data

To start the floor over on the Linux Docker host, keeping users and base data, run from the release folder that holds `compose.yml` and `.env` (`~/dana-apps` after `Deploy-MeshForge`):

```bash
cd ~/dana-apps
bash commands/CLEAR-OPERATIONAL-DATA.sh
```

`dana-postgres` must be running. Docker Compose v2 (`docker compose`) and v1 (`docker-compose`) both work. The script:

0. asks whether to **keep** the shelf/layer/bin locations (`CGDR-A1A` etc.) and `COATER-STAGING`, empty, and delete the rest (option 1, the default), or **delete all** locations (option 2). To skip the question, pass `--locations=keep-shelves` or `--locations=delete-all`;
1. previews what is emptied, deleted and kept, changing nothing;
2. asks for the exact phrase `CLEAR DATA`;
3. saves a full `pg_dump` backup to `~/dana-apps-backups/MeshForge-before-clear-<UTC time>.dump` (owner-only, with a `.sha256`; outside the release folder, which each deploy replaces; set `MESHFORGE_BACKUP_DIR` for another folder), checks that it can be read, and stops if it cannot;
4. stops `meshforge-server`, runs `tools/manufacturing/data-import/clear-operational-data.mjs --apply` in a one-off container from the `meshforge-server` image (the script folder is mounted from the host, so the image does not need rebuilding), and starts `meshforge-server` again, even if the clear failed.

Tables left by older releases that point at the operational data (for example `dana_coater_set_blades_v147`) are found from the database's foreign keys and emptied too; the preview lists them. The preview stops before anything is deleted, and before the backup, if a kept table points at operational data or other rows point at a location that would be deleted. The clear runs in one transaction: on any error nothing is deleted. What is emptied and kept is listed in "Clear operational data, keep users and base data" in `START_AND_TEST_GUIDE.md`. Row counts from just before the clear are in `tools/manufacturing/data-import/work/pre-clear-operational-data-manifest.json`.

To undo, stop `meshforge-server` and restore the backup:

```bash
docker compose cp ~/dana-apps-backups/MeshForge-before-clear-<UTC time>.dump dana-postgres:/tmp/restore.dump
docker compose exec dana-postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/restore.dump'
docker compose start meshforge-server
```
