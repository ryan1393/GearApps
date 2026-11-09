# Truck Log 1.0.3

Truck Log runs the guard shack and dock workflow at Dana Fort Wayne: truck check-in, dock assignment and the dock board, packing slips and driver paperwork, final checkout, TV boards, and the RXO and RXO Expedite load feeds. It runs as a set of Docker containers on one Linux Docker host. Guard PCs, dock PCs and TVs use it through a web browser.

What changed in this release: [CHANGELOG.md](CHANGELOG.md).

RXO and RXO Expedite now offer **Recover connection** when the connection needs review. Sign in as an administrator to queue recovery; credential and MFA issues direct you to **Settings & Login**. See [RXO connection recovery](docs/truck-log/RXO-CONNECTION-RECOVERY.md).

To update an existing installation, keep its `.env` and named volumes, then run setup from the new `truck-log/` folder. Rebuild the API, web app, and both RXO workers together so their release labels match. HTTPS installations must use both Compose files as described in [HTTPS deployment](docs/truck-log/HTTPS.md).

## Install

You need a Linux Docker engine with Docker Compose v2. You can run the commands on that Linux host, or on a Windows PC whose Docker CLI points at it through a Docker context.

**Windows control PC**

1. Extract the ZIP to a local folder.
2. Select the Docker context for the Linux host (`docker context use <name>`).
3. Run `SETUP-TRUCK-LOG.cmd`.

For a remote Linux host over SSH, follow [docs/truck-log/WINDOWS-REMOTE-DOCKER-INSTALL.md](docs/truck-log/WINDOWS-REMOTE-DOCKER-INSTALL.md).

**Linux host**

```sh
unzip Truck-Log-1.0.3.zip && cd Truck-Log-1.0.3
./SETUP-TRUCK-LOG.sh
```

Setup creates `.env` with a generated database password and signing secret, builds the images, starts everything and waits for the API and web to report healthy. Running it again is safe: it keeps `.env` and all data. It never deletes volumes.

Then open `http://<docker-host>:4300`. For production TLS, use the supported [HTTPS deployment](docs/truck-log/HTTPS.md). The HTTPS overlay requires a trusted certificate and Docker Compose 2.24.4+.

## First-time setup

1. **Create the first administrator** (from the folder on the Docker host, in an interactive terminal):
   ```sh
   ./SETUP-TRUCK-LOG-ADMIN.sh --bootstrap      # Windows: SETUP-TRUCK-LOG-ADMIN.cmd --bootstrap
   ```
   Sign in at `/admin/login` and change the temporary password.
2. **Register every guard PC and TV as a station.** In the web app go to **Admin → Stations**, add the station, and enter the 8-character code it shows at `/station/setup` on that PC or TV. Guard screens and the API are unavailable until a browser is paired or an administrator is signed in. See [docs/truck-log/STATIONS.md](docs/truck-log/STATIONS.md).
3. **RXO and RXO Expedite logins:** RXO Control Center → Settings & Login (signed in as administrator), or `SETUP-RXO-INTEGRATION-CREDENTIALS` / `SETUP-RXO-EXPEDITE-CREDENTIALS`. See [docs/truck-log/RXO-WEB-CREDENTIAL-SETUP.md](docs/truck-log/RXO-WEB-CREDENTIAL-SETUP.md).
4. **Print Agent PC (optional):** `SETUP-PRINT-AGENT-CREDENTIAL.cmd --agent-id trucklog-print-pc-01 --name "Guard shack printer"` creates the token the Windows Print Agent uses. Without a configured agent, choose **Manual / browser printing** at check-in. The saved visit provides its printable slip; automatic printing becomes available after the gate and printer are configured. Save the gate printer under Administration → Printing. Check-in offers **Print manually in browser** when automatic printing is unavailable or when you choose to print manually. Manual mode saves the visit without queuing automatic Dock Assignment or RXO printing; open the Dock Assignment slip after saving and retrieve RXO paperwork from Records.

## Replacing an older test install

1.0.3 does not upgrade a 0.1 database: the schema was rebuilt as one baseline, and the 0.1 builds were test installs. Setup and start check for an older install first. If they find containers or volumes with Truck Log's names that belong to another Docker Compose project (for example `truck-log-v02` or `truck-log-nxdev`), they stop and list them instead of failing halfway through.

If that install holds only test data, remove it, then run setup again. **This deletes that install's data.** The script lists what it will remove and asks you to type `REMOVE`.

```sh
REMOVE-OLD-TRUCK-LOG-INSTALL.cmd          # Windows
./REMOVE-OLD-TRUCK-LOG-INSTALL.sh         # Linux
```

By default it removes only the other install's containers and volumes. On a test host where Truck Log's own volumes also hold old 0.1 data (setup says so), use `-All` (Windows) or `--all` (Linux) to remove every Truck Log container and volume.

Use `SETUP-TRUCK-LOG` and `START-TRUCK-LOG` rather than running `docker compose` yourself. They take the image version from the `VERSION` file, so an old `TRUCK_LOG_RELEASE` setting left in your environment can't build images with an old tag.

## Everyday commands

| Task | Windows | Linux |
|---|---|---|
| Start / stop | `START-TRUCK-LOG.cmd` / `STOP-TRUCK-LOG.cmd` | `./START-TRUCK-LOG.sh` / `./STOP-TRUCK-LOG.sh` |
| Health of every service | `STATUS-TRUCK-LOG.cmd` | `./STATUS-TRUCK-LOG.sh` |
| Logs | `LOGS-TRUCK-LOG.cmd` | `./LOGS-TRUCK-LOG.sh` |
| RXO exporter status / logs | `STATUS-RXO-INTEGRATION.cmd`, `LOGS-RXO-EXPORT.cmd` | `./STATUS-RXO-INTEGRATION.sh`, `./LOGS-RXO-EXPORT.sh` |
| Import reference data CSV | `IMPORT-TRUCK-LOG-REFERENCE-CSV.cmd` | `./IMPORT-TRUCK-LOG-REFERENCE-CSV.sh` |
| Restore the Fort Wayne dock list | `SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd` | `./SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.sh` |
| Training data | `LOAD-MOCK-DATA.cmd`, `CLEAR-MOCK-DATA.cmd` | `./LOAD-MOCK-DATA.sh`, `./CLEAR-MOCK-DATA.sh` |

## What runs

| Service | Container | Purpose |
|---|---|---|
| `truck-log-postgres` | `truck-log-postgres` | PostgreSQL 16 |
| `truck-log-server` | `truck-log-server` | API (NestJS). Applies database migrations on start. |
| `truck-log-web` | `truck-log-web` | Web app (Angular, served by nginx) |
| `rxo-export` | `truck-log-rxo-export` | Scheduled standard RXO export |
| `rxo-expedite-scheduler` | `truck-log-rxo-expedite-scheduler` | Scheduled RXO Expedite export |
| `rxo-browser` | `truck-log-rxo-browser` | Optional: interactive RXO login (profile `rxo-browser`) |

- **Docker project and network:** `truck-log`.
- **Ports** (change them in `.env`): web `4300`; API `3334` and RXO browser `6080` are bound to host loopback by default. Remote Print Agents and watchers should use `http://<docker-host>:4300/api/v1` or the HTTPS web origin. Explicit API publishing is available through `TRUCK_LOG_API_BIND_ADDRESS` when needed.
- **Data:** kept in eight named volumes: `truck-log-postgres-data`, `truck-log-documents`, `truck-log-rxo-import`, `truck-log-rxo-data`, `truck-log-rxo-state`, `truck-log-rxo-credentials`, `truck-log-rxo-expedite-data`, `truck-log-rxo-expedite-state`.

## Database

The schema lives in `database/truck-log/migrations/`: `0001_baseline.sql` plus numbered changes after it. The server applies any pending migrations when it starts, each in its own transaction, and records them in `truck_log_schema_migrations`. See [docs/truck-log/DATABASE-MIGRATIONS.md](docs/truck-log/DATABASE-MIGRATIONS.md).

## Upgrading from 1.0.0

Keep your existing `.env` and all named volumes. This patch adds migration `0005_print_workflow_recovery.sql` without rewriting earlier migrations. Configure remote agents to use the web/API address before updating because direct API port 3334 now defaults to loopback. HTTPS users must keep both Compose files in every lifecycle command. See [queued print recovery](docs/truck-log/PRINT-RECOVERY.md) and [HTTPS](docs/truck-log/HTTPS.md).

## Upgrading to a later release

Back up the `truck-log-postgres-data` and `truck-log-documents` volumes, extract the new release next to the old folder, and copy your `.env` into it. Then run setup from the new folder. Pending migrations apply automatically on start.

## Version

The release is in [`VERSION`](VERSION) (`1.0.3`). Every other copy must match it, and `tests/new-host/test-release-version.mjs` fails if one drifts. To release a new version, edit `VERSION`, update the copies that test lists, and run `node tools/truck-log/refresh-manifests.mjs`.

## Checks

```sh
npm run validate:all       # every source/contract test
npm run validate:release   # installed source/release checks
npm run validate:archive   # clean extracted package only; before npm ci
sha256sum -c MANIFEST-SHA256.txt
```

Run `npm ci` before installed checks; run archive hygiene checks on a separate clean extraction. Source development uses Node.js 22.12+ (or a supported Node.js 24 release).

The checks above don't build Docker images. Build and start on a real Docker host before you roll out a release.

## More documentation

[ARCHITECTURE](docs/truck-log/ARCHITECTURE.md) · [DEPLOYMENT](docs/truck-log/DEPLOYMENT.md) · [ENVIRONMENT](docs/truck-log/ENVIRONMENT.md) · [STATIONS](docs/truck-log/STATIONS.md) · [DATABASE-MIGRATIONS](docs/truck-log/DATABASE-MIGRATIONS.md) · [RXO-INTEGRATION](docs/truck-log/RXO-INTEGRATION.md) · [NX-WORKSPACE](docs/truck-log/NX-WORKSPACE.md) · [MAINTAINABILITY](docs/truck-log/MAINTAINABILITY.md) · [CONTRIBUTING](CONTRIBUTING.md)
