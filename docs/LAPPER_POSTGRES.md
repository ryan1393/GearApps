# Lapper with GearApps 70.3.0 PostgreSQL

Lapper and Lapper Read use the existing GearApps PostgreSQL database. The Windows
collector calls the Lapper API; it does not connect to PostgreSQL directly.

| Service            | Default host port          | Database                            |
| ------------------ | -------------------------- | ----------------------------------- |
| Manufacturing API  | 3333                       | `GEAR_DB_NAME` (default `GearApps`) |
| Lapper API         | 3334                       | the same database                   |
| Lapper browser app | 4203                       | through Lapper API                  |
| Lapper Read worker | outbound HTTP to port 3334 | through Lapper API                  |

## Configure and start

For the combined Docker deployment, use `manufacturing/.env.example` as the
template for `manufacturing/.env`. Retain the current database name, user,
password, PostgreSQL volume name and existing manufacturing JWT secrets. Add a
separate `LAPPER_JWT_SECRET` of at least 32 random characters, for example:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
docker compose --env-file manufacturing/.env -f manufacturing/compose.yml config --quiet
docker compose --env-file manufacturing/.env -f manufacturing/compose.yml up -d --build
```

Use the same PostgreSQL volume that holds the current GearApps database. Lapper
waits for the existing GearApps bootstrap, then applies a versioned, transactional
migration in schema `lapper`. `DATABASE_SYNCHRONIZE=false` is required; Lapper
refuses to start if ORM synchronization is enabled for shared PostgreSQL.
Startup neither copies accounts nor recreates manufacturing tables. It requires
permission to create/alter the Lapper schema and read shared master/account data.
Admin master-data writes also require the corresponding public-table permissions.

For development or a separate Lapper API host, copy root `.env.example` to `.env`,
set the existing GearApps `DATABASE_*` connection and a separate `JWT_SECRET`,
then run `npm run serve:lapper-api` and `npm run serve:lapper-client`. For a remote
TLS-enabled database use `DATABASE_SSL=true` and a certificate chain trusted by
Node. In root `docker-compose.yml`, the database host must be reachable from the
API container, such as `host.docker.internal` for a database on the Docker host.

## Shared records and history

- Login uses current active `public.users` accounts, including their bcrypt
  password hashes. Email, username and employee number are accepted. Disabled or
  deleted accounts lose API access, including previously issued tokens.
- Public registration and account edits are handled by GearApps. Lapper access
  tokens carry their own purpose claim and signing key.
- Departments, machines, parts, summaries and complete gearset assemblies use the
  existing public masters. Lapper machine/scanner settings and production records
  live in `lapper`. Public machine IDs and gearset IDs are returned to clients;
  original imported IDs remain on historical rows.
- Machines need a Lapper profile containing their FANUC IP and scanner assignment.
  Existing GearApps machines can be selected by asset number when adding a profile.
  Only GearApps administrators can change setup/master data. Operators can record
  cycles, macro values, scanner serial slots and FANUC signal snapshots.
- Complete new gearsets created through Lapper's Gearsets form also create their
  shared GearApps assembly and gearset part. The ring and pinion must be active,
  share a summary number (revisions may differ) and have valid tooth counts. An unknown number first encountered
  by a collector remains a pending Lapper reference until its assembly is defined.
  Earlier history follows the canonical assembly when the number is matched.
- Shared master deletion, machine department/asset changes and changes to parts
  already used in assemblies go through GearApps' guarded workflows. Production
  cycles and macro history cannot be deleted through the Lapper API.

The application's schema migration creates empty Lapper tables if needed. It does
**not** import the old SQL Server backup. Apply the separately prepared, validated
combined `Apply-DatabaseCleanup.ps1` or `Apply-DatabaseCleanup.sh` package to the current database to bring across
old machines, macros and history before integrity cleanup. See [the host update procedure](DATABASE_INTEGRITY.md).
That private package and all database dumps are
kept outside this repository. Startup also works when the import is already applied.

Imported SQL Server timestamps have no offset. `LAPPER_TIME_ZONE` controls their
interpretation (default `America/Indianapolis`). Set it to the original plant time
zone before use. Their original values remain intact. New collector timestamps
retain their UTC offset and millisecond precision in `recorded_at`.

## Configure Lapper Read

Build/publish the Windows worker using [its setup instructions](../apps/lapper-read/SETUP.txt).
Configure machine/scanner IPs and supply these service environment variables:

```powershell
$env:LapperApi__BaseAddress = 'http://YOUR-GEARAPPS-HOST:3334'
$env:LapperApi__Email = 'YOUR-GEARAPPS-USERNAME'
$env:LapperApi__Password = 'YOUR-GEARAPPS-PASSWORD'
$env:LapperConfiguration__MachineNumber = 'YOUR-MACHINE-ASSET-NUMBER'
```

Set `MachineNumber` where IPs are duplicated; ambiguous lookup returns 409 rather
than selecting an arbitrary machine. The scanner must belong to that machine.
Keep the worker's checkpoint/state files during upgrades. The PostgreSQL API
honors stable cycle/macro `Idempotency-Key` headers in the same transaction as
the write, returning the saved response on replay and 409 for conflicting payloads.

## Validate on a restored copy

Restore a GearApps database plus the legacy import into a disposable database
whose name ends with `_lapper_test`. Set its `DATABASE_HOST`, `DATABASE_PORT`,
`DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME`, then explicitly enable
test fixtures with `GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES` and run:

```sh
npm run test:lapper-postgres
dotnet test apps/lapper-read/LapperRead.Tests/LapperRead.Tests.csproj -c Release
```

The PostgreSQL integration suite exercises the real HTTP controllers, authentication,
historical projections, decimal values, UTC precision, concurrent retry deduplication,
scanner/FANUC telemetry, shared assemblies and pending-history linkage. It compares
every public table before and after cleanup to catch unintended GearApps changes.
Run it only on the disposable copy: it deliberately leaves test history in `lapper`.
Hardware timing and the licensed FANUC DLL still require a station acceptance test.
