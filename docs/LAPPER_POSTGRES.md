# Lapper in the shared MeshForge API

Lapper, Blade Tracking, Cutter Builder, Greenshed and Lapper Read use the same
API at /api/v1 on port 3333 and the same MeshForge PostgreSQL database. There is
one server project (meshforge-server), one authentication service and one
.env configuration. [Upgrade and architecture](UNIFIED_API.md)
describe the unified deployment.

The four browser ports remain 4200-4203. Lapper's nginx and development proxy
send /api requests to the same API as the manufacturing clients. Lapper Read
connects directly to that API on port 3333, using its `MESHFORGE_API_...` settings.

Public users, departments, machines, parts, summaries and gearsets are canonical
shared records. Lapper profiles, telemetry and history remain in schema lapper
with links to those masters. Canonical IDs are returned to clients; legacy IDs
and reconstructed original records remain queryable through archive/alias views.
Unknown collector gearsets remain pending until a shared assembly is defined.
Historical timestamps use LAPPER_TIME_ZONE (default America/Indianapolis); their
original values and new offset-aware collector timestamps are preserved.

Web clients sign in with an existing MeshForge email/password through
POST /api/v1/auth/email/login (camel-case accessToken/refreshToken responses,
the existing JWT_ACCESS_SECRET / JWT_REFRESH_SECRET). Collectors use a collector
token (Lapper > Configuration > Collector Tokens) instead. Shared account role,
department and authVersion determine access. Account management is in MeshForge.
The separate Lapper JWT secret, local registration and standalone API are removed.

Administrators manage setup. Machine data (cycles, macro values, Fanuc I/O
snapshots, scanner serial slots and pending gearsets) is sent by collector tokens
or administrators; other accounts get HTTP 403 ("Only Lapper Read collector tokens
and MeshForge administrators can send machine data"). The rules follow the route
the API matched, never the request URL text. Shared deletions and manufacturing inventory changes use
the existing guarded workflows. Cycle and macro retries use transactional request
keys and natural database uniqueness. Request keys (lapper.ingest_requests) are
kept for 90 days; older ones are removed in batches at startup and daily. Conflicting snapshots return HTTP 409.

Keep all collector checkpoint/state files. The
[collector README](../apps/lapper-read-py/README.md) explains build and configuration.

The private backup-first legacy import/cleanup package is separate from source.
If the owner already applied it successfully, use that existing database. Startup
replays the checksummed integrity migrations without reimporting source data.
See [database integrity](DATABASE_INTEGRITY.md) for audit and recovery procedures.

To test, restore a disposable database ending in _lapper_test, set its DATABASE_*
environment variables and MESHFORGE_ALLOW_TEST_ACCOUNTS=YES, then run
npm run test:lapper-postgres. This suite uses the actual unified API. It leaves
test history in the isolated lapper schema; never run it against the shared server.
