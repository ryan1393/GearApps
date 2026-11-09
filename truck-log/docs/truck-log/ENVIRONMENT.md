# Truck Log environment

The real `.env` in the extracted Truck Log folder is authoritative.

## Required database values

```text
TRUCK_LOG_DATABASE_HOST
TRUCK_LOG_DATABASE_PORT
TRUCK_LOG_DATABASE_USERNAME
TRUCK_LOG_DATABASE_PASSWORD
TRUCK_LOG_DATABASE_NAME
TRUCK_LOG_DATABASE_SSL
TRUCK_LOG_DATABASE_SYNCHRONIZE
```

Truck Log uses its own PostgreSQL database and should not point at the Gear Apps application database.

`TRUCK_LOG_DATABASE_PASSWORD` has no shipped default. Keep the real value only
in the untracked local `.env`, and replace any legacy `api` development password
before a production deployment.

Required setting (the API refuses to start when set to `true`):

```text
TRUCK_LOG_DATABASE_SYNCHRONIZE=false
```

## Application ports

```text
TRUCK_LOG_API_PORT=3334
TRUCK_LOG_API_BIND_ADDRESS=127.0.0.1
TRUCK_LOG_WEB_PORT=4300
```

Operator browser URL:

```text
http://localhost:4300
```

The Angular browser app uses same-origin `/api/v1`; local Nx development proxies that path to the API.

The direct API port is reachable only on the Docker host by default. Print Agents and the SAP watcher should use the web server's `/api/v1` URL. Set `TRUCK_LOG_API_BIND_ADDRESS` explicitly only if a direct remote API port is required.

## HTTP and HTTPS

The base deployment supports `TRUCK_LOG_ADMIN_TRANSPORT=internal-http`, explicitly set in `.env.example`. Existing installations without that variable retain HTTP compatibility. This mode does not encrypt network traffic.

For TLS use the optional `docker-compose.https.yml` overlay, `TRUCK_LOG_ADMIN_TRANSPORT=https`, an HTTPS public/CORS origin, `TRUCK_LOG_ADMIN_PROXY_KEY`, and `TRUCK_LOG_TLS_CERT_DIR` on the Docker host. The overlay fixes the transport to HTTPS, sets the trusted proxy IP from `TRUCK_LOG_TLS_PROXY_IP`, and replaces the HTTP port with `TRUCK_LOG_TLS_PORT` (default 443). See [HTTPS deployment](HTTPS.md) for certificate trust, Docker Compose version, dedicated subnet and lifecycle commands.

## Time zone

Set:

```text
TZ=America/Indiana/Indianapolis
```

or the correct plant time zone.

Truck Log uses `TZ` for operator-facing date filters and “checked out today” database calculations.

## Paperwork

```text
TRUCK_LOG_DOCUMENT_STORAGE_ROOT
TRUCK_LOG_MAX_DOCUMENT_MB
```

The database stores stable relative document keys/paths. For local execution,
`TRUCK_LOG_DOCUMENT_STORAGE_ROOT` selects the physical root. Docker Compose
deliberately overrides it to `/data/truck-log-documents`, backed by the Compose-managed
`truck-log-documents` named volume. Back up and restore that named volume with
the database; there is no unused host-path override.

## Print Agent status

```text
TRUCK_LOG_PRINT_AGENT_OFFLINE_SECONDS=90
```

This controls when a registered native Windows Print Agent is shown as Offline. Valid values are 30 through 3600 seconds; invalid values safely fall back to 90. Agent bearer tokens are provisioned into PostgreSQL as hash-only credentials and must not be placed in Truck Log `.env` or Docker Compose.

## Driver Print Package routing

```text
TRUCK_LOG_DRIVER_PRINT_AGENT_ID
TRUCK_LOG_DRIVER_PRINT_ROUTE
TRUCK_LOG_DRIVER_PRINT_PRINTER
TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET
```

Keep all three blank until the dedicated Windows Print Agent is installed and
has reported its exact route/output-printer binding. Truck Log never guesses
routing. Blank, offline, disabled, or mismatched settings preserve check-in and
produce a visible retryable RXO-document failure.

`TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET` must be a dedicated 256-bit value encoded
as exactly 64 hexadecimal characters. Generate it outside source control with
`openssl rand -hex 32`, configure the same value on every Truck Log API replica,
and keep it stable across restarts. Truck Log uses it only to derive short-lived
Print Agent job claim tokens; no raw claim token is stored in PostgreSQL. Drain
the maximum lease plus the 30-minute claim retry window before rotating it.

Materials/reprint `tloa_...` access tokens and Print Agent bearer tokens are
provisioned into PostgreSQL as hash-only credentials. Do not place raw tokens in
`.env`, Compose, source control, or persistent browser storage.

The current local/office HTTP ports are development compatibility endpoints.
Before production use of authenticated upload/download and agent job routes,
terminate TLS at an approved reverse proxy and firewall direct API port 3334.

## Plant identity and dock master

Plant identity, slip footer text, and dock configuration are database-managed settings rather than Docker environment variables. A fresh Truck Log database seeds:

- site name: `Dana Fort Wayne Plant`
- plant location: `Fort Wayne`
- the authoritative 9-dock Fort Wayne master
- the standard driver-slip footer

Use the Truck Log settings/admin workflow for normal changes. `SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd` is an explicit repair/reset utility for the exact Fort Wayne dock master and is not run on every container restart.

## CORS

`TRUCK_LOG_CORS_ORIGINS` is only needed for direct cross-origin browser calls. Normal local and nginx operation use same-origin `/api`.

## Addresses and station sign-in

- `TRUCK_LOG_WEB_PORT` and `TRUCK_LOG_API_PORT` in `.env` are the **host** ports Docker publishes. Inside the containers the API always listens on 3334 and nginx on 80.
- `TRUCK_LOG_PUBLIC_ORIGIN` is the address people type, e.g. `http://trucklog.plant.local:4300`. Setup fills it in from the Docker host name.
- `TRUCK_LOG_CORS_ORIGINS` lists every other address browsers use.

Station pairing, and every request that changes data, is refused unless it comes from one of those addresses. If guard PCs reach Truck Log by IP and by name, list both. Changing them requires `docker compose up -d truck-log-server`.
