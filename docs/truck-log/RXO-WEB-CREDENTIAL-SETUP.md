# RXO Web Credential Setup

This is an **optional, explicit administrator setup** after the ordinary Linux Docker
installation. The normal installer does not create privileged accounts, configure
Expedite credential write origins, or store RXO passwords in `.env`.

## Preconditions

- Docker Compose services have been built and the API/web are healthy.
- The DNS name/IP used in the browser is `TRUCK_LOG_PUBLIC_ORIGIN` in `.env`,
  including the port and protocol (e.g. `http://trucklog.internal:4300`).
- `TRUCK_LOG_CORS_ORIGINS` permits the browser origin, but it does **not** authorize
  Expedite credential writes by itself.
- Access must be limited to authorized administrators. HTTP exposes login and
  RXO credentials on the transport; for remote access use VPN or an approved HTTPS
  deployment with matching administration transport configuration. The packaged
  Compose setup uses `internal-http` admin transport, not automatic TLS termination.

## 1. Create the first Truck Log administrator account

From the Linux Docker host, in the extracted project folder:

```sh
./SETUP-TRUCK-LOG-ADMIN.sh --bootstrap
./SETUP-TRUCK-LOG-ADMIN.sh --verify
```

The script runs interactively **inside the API Docker image**, without requiring
Node.js on the Linux host. Passwords are prompted in the terminal, never passed
as arguments or written into the source package. First login forces a password
change. For an existing account, use `--recover` rather than replaying bootstrap.
The administrator tables are created by the baseline migration when the server
first starts; this utility only creates and recovers accounts.

### Browser login

Open `http://YOUR-TRUCK-LOG-HOST:4300/admin/login` (replace with the configured
public origin), sign in, and change the temporary password. If the admin page
says setup is unavailable, confirm the origin matches exactly and that the
server has started at least once.

## 2. Standard RXO — Settings & Login

Open `/rxo`, then **Settings & Login**. Enter the Standard RXO username and
password and save. The API writes `rxo_username` / `rxo_password` to the named
`truck-log-rxo-credentials` Docker volume. The `rxo-export` worker reads those
files read-only. Saving new credentials does not replace Expedite credentials.

Saving without a new password retains the existing Standard RXO password. For a
first-time setup enter both username and password. If RXO prompts for MFA, use
`./BOOTSTRAP-RXO-BROWSER.sh` separately.

Standard RXO status and writes use a small `alpine:3.20` helper image via the
Docker socket. This image must be pullable by the Docker host; if the host is
restricted, pre-pull it (`docker pull alpine:3.20`) while provisioning the server.

## 3. RXO Expedite — Settings & Login

Expedite adds an **independent, explicit browser-origin write policy**. Before
web saving is enabled, edit `.env` on the Docker host and set:

For a correctly configured HTTPS deployment:

```ini
TRUCK_LOG_RXO_EXPEDITE_CONTROL_ORIGIN=https://trucklog.example.internal
TRUCK_LOG_RXO_EXPEDITE_ALLOW_HTTP=false
```

For a restricted internal HTTP-only deployment, only if you explicitly accept
unencrypted traffic on your trusted/VPN network:

```ini
TRUCK_LOG_RXO_EXPEDITE_CONTROL_ORIGIN=http://trucklog.internal:4300
TRUCK_LOG_RXO_EXPEDITE_ALLOW_HTTP=true
```

The control origin **must match the browser origin exactly**, including scheme
and port, with no trailing slash or path. It should also match
`TRUCK_LOG_PUBLIC_ORIGIN` for this single-origin web deployment. Restart only
the API container to load the changed environment (does not delete volumes):

```sh
docker compose up -d --no-deps --force-recreate truck-log-server
```

On the `/rxo-expedite` page, open **Settings & Login** and save the independent
Expedite username and password. Its credential files live under versioned
`rxo_expedite_*` paths in the same named credential volume, and are not the
Standard RXO username/password. Browser credential updates do **not** expose
the Expedite password in GET responses.

Changing the environment config is **not a substitute** for administrator
provisioning and login. The API enforces session, CSRF, request intent, and exact
origin checks. The optional HTTP policy only bypasses Expedite's HTTPS-only
origin restriction; it does not make HTTP encrypted.

## 4. Post-setup checks

```sh
./VERIFY-RXO-WEB-SETUP.sh
```

The verification is read-only, reports API readiness, configured origin policy,
admin-schema/account readiness, and whether both credential sets are configured.
It does not show passwords or invoke an RXO export. In the browser, confirm
Standard RXO and Expedite both show **Username Saved** and **Password Saved**.

### Workflow invariants

- The normal check-in, scheduled loads, driver printing, documents, dashboard,
  TV, RXO ingestion/auto scan, and Expedite isolation remain unchanged.
- No 001–010 business migration is replayed or removed by admin setup.
- No existing Docker volume is deleted, renamed, or reset.
- No installer automatically accepts an insecure HTTP credential-write policy.
- This does **not** test live RXO website authentication/MFA or actual printing;
  those require authorized live systems.
