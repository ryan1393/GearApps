# Truck Log Deployment

For encrypted production access, follow [HTTPS deployment](HTTPS.md). It adds an optional Compose overlay and requires a trusted certificate on the Docker host. The setup/start wrappers below describe the base HTTP deployment; HTTPS lifecycle commands always include both Compose files.

## Fresh Windows control PC

1. Install Docker Desktop or Docker CLI with Docker Compose v2+ and select the target Linux Docker context.
2. Extract the Truck Log ZIP to a normal local folder.
3. Run `SETUP-TRUCK-LOG.cmd`.
4. Wait for the script to report `PASS - TRUCK LOG INITIAL SETUP COMPLETE`.
5. Run `STATUS-TRUCK-LOG.cmd` and confirm the core containers are healthy.
6. Confirm the fresh database shows the Fort Wayne 9-dock master; it is seeded by the baseline migration.
7. Configure standard RXO and RXO Expedite credentials if those integrations will run.
8. Configure the separate physical Print Agent host if printing is required.

The setup can target a local Linux Docker Desktop engine or a remote Linux Docker engine selected by Docker context. For a remote context, verify the web port is reachable from operator clients and adjust `TRUCK_LOG_PUBLIC_ORIGIN`/`TRUCK_LOG_CORS_ORIGINS` in `.env` when needed. Browsers and Print Agents use the web server's `/api/v1` route; direct API port 3334 binds to the Docker host's loopback interface by default. `TRUCK_LOG_API_BIND_ADDRESS` can explicitly change that binding when required.

See `WINDOWS-REMOTE-DOCKER-INSTALL.md` for an explicit SSH-context walkthrough,
network/credential steps, and verification commands. Remote Windows setup now
treats the example `http://localhost:4300` origin as an unconfigured placeholder.

## Fresh Linux Docker host

1. Install Docker Engine/CLI with Docker Compose v2+.
2. Extract the package.
3. If the scripts lost their execute bit while copying, run `chmod +x *.sh tools/truck-log/*.sh`.
4. Run `./SETUP-TRUCK-LOG.sh`.
5. Run `./STATUS-TRUCK-LOG.sh`.
6. Confirm the fresh database shows the Fort Wayne 9-dock master.
7. Configure RXO credentials as needed.

## Preparation without starting

Windows:

```text
SETUP-TRUCK-LOG.cmd -NoStart
```

Linux:

```sh
./SETUP-TRUCK-LOG.sh --no-start
```

This prepares `.env`, named volumes, network, and Compose validation without building/starting the stack.

## Existing host / upgrade

The normal setup is designed to be rerunnable. It preserves an existing `.env` and named volumes. Pending numbered migrations are applied at server start; the database is never reset. A database left by a 0.1 test build is refused; see README.md, 'Replacing an older test install'.

Before an upgrade of a production host, take deliberate backups of the PostgreSQL and document/runtime volumes. Do not use source ZIP replacement as a substitute for data backup.

## Credentials

Secrets are not shipped in this ZIP. Fresh setup generates only internal database/claim-token secrets. RXO credentials must be entered separately through the credential setup helpers. An optional web workflow also exists, but first requires explicit administrator schema/account setup and a matching Expedite origin policy. See `RXO-WEB-CREDENTIAL-SETUP.md` and run `SETUP-TRUCK-LOG-ADMIN.sh --bootstrap` from the Docker host to create the first administrator. Then pair each guard PC and TV as a station (`docs/truck-log/STATIONS.md`).

The `.env` file and named credential volume are runtime assets and should not be committed into source control or copied into support bundles without explicit secret handling.

## Troubleshooting

Windows:

```text
STATUS-TRUCK-LOG.cmd
LOGS-TRUCK-LOG.cmd
```

Linux:

```sh
./STATUS-TRUCK-LOG.sh
./LOGS-TRUCK-LOG.sh
```

If setup fails during image build, retain the build output. If the API fails during startup, inspect the server log first: database migrations run before NestJS starts (`docs/truck-log/DATABASE-MIGRATIONS.md`).

## Reference data and dock maintenance

These maintenance commands are Docker-first and execute their Node.js/database code inside the running `truck-log-server` image. A fresh Docker control PC/host does not need host Node.js for them.

Windows:

```text
IMPORT-TRUCK-LOG-REFERENCE-CSV.cmd
SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd
CLEAR-TRUCK-LOG-DATA.cmd
```

Linux:

```sh
./IMPORT-TRUCK-LOG-REFERENCE-CSV.sh
./SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.sh
./CLEAR-TRUCK-LOG-DATA.sh
```

`CLEAR-TRUCK-LOG-DATA` is destructive and requires an explicit `CLEAR` confirmation. It preserves plant/settings and users/authentication but clears docks along with operational, RXO, and reusable reference rows. Restore the Fort Wayne dock master afterward with the sync helper when appropriate.

## Optional Node.js workstation tools

Interactive standard-RXO browser bootstrap, redacted RXO diagnostic collection, and Nx source development run host-side JavaScript. Use the supported Node.js 22 LTS runtime on that workstation. These tools are not prerequisites for the normal Docker installation or service controls.

