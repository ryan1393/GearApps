# Lapper in the shared GearApps API

Lapper, Blade Tracking, Cutter Builder, Greenshed and Lapper Read use the same
API at /api/v1 on port 3333 and the same GearApps PostgreSQL database. There is
one server project (gear-app-server), one authentication service and one
manufacturing/.env configuration. [Upgrade and architecture](UNIFIED_API.md)
describe the unified deployment.

The four browser ports remain 4200-4203. Lapper's nginx and development proxy
send /api requests to the same API as the manufacturing clients. Lapper Read
connects directly to that API on port 3333, using its GearAppsApi configuration.

Public users, departments, machines, parts, summaries and gearsets are canonical
shared records. Lapper profiles, telemetry and history remain in schema lapper
with links to those masters. Canonical IDs are returned to clients; legacy IDs
and reconstructed original records remain queryable through archive/alias views.
Unknown collector gearsets remain pending until a shared assembly is defined.
Historical timestamps use LAPPER_TIME_ZONE (default America/Indianapolis); their
original values and new offset-aware collector timestamps are preserved.

Sign in with an existing GearApps email/password. Both web clients and collectors
use POST /api/v1/auth/email/login, camel-case accessToken/refreshToken responses,
and the existing JWT_ACCESS_SECRET / JWT_REFRESH_SECRET. Shared account role,
department and authVersion determine access. Account management is in GearApps.
The separate Lapper JWT secret, local registration and standalone API are removed.

Administrators manage setup; operators can record cycles, macro snapshots and
scanner serial slots. Shared deletions and manufacturing inventory changes use
the existing guarded workflows. Cycle and macro retries use transactional request
keys and natural database uniqueness. Conflicting snapshots return HTTP 409.

For duplicate machine IPs, configure LapperConfiguration__MachineNumber. The
scanner must belong to that machine. Keep all worker checkpoint/state files.
[Collector setup](../apps/lapper-read/SETUP.txt) explains build and configuration.

The private backup-first legacy import/cleanup package is separate from source.
If the owner already applied it successfully, use that existing database. Startup
replays the checksummed integrity migrations without reimporting source data.
See [database integrity](DATABASE_INTEGRITY.md) for audit and recovery procedures.

To test, restore a disposable database ending in _lapper_test, set its DATABASE_*
environment variables and GEAR_APPS_ALLOW_TEST_ACCOUNTS=YES, then run
npm run test:lapper-postgres. This suite uses the actual unified API. It leaves
test history in the isolated lapper schema; never run it against the shared server.
