# Truck Log — Windows controller, remote Linux Docker host

This procedure runs the installer from Windows and creates all containers and
named volumes on the selected Linux Docker engine. The Windows PC only holds
the checked-out source, local `.env`, Docker CLI/context, and setup utilities.

## Prerequisites

- A Linux Docker host with Docker Engine and enough disk/RAM for application
  builds and Playwright. Docker CLI/Compose v2 is installed on Windows.
- Windows OpenSSH Client and PowerShell 5.1 or later.
- Trusted SSH account on Linux with permission to use the Docker UNIX socket.
  Docker group membership is equivalent to root-level host control.
- DNS/VPN/routing from Windows to the Linux host. TCP 22 (or configured SSH
  port) for management and TCP 4300 from operator workstations to the host.
  API TCP 3334 is only needed for clients that access the API directly.

## 1. Verify remote Linux access

In Windows PowerShell, replace placeholders with your real login/hostname:

```powershell
ssh deployuser@linux-host
```

After connecting to Linux:

```sh
docker info --format '{{.OSType}}'
docker compose version
exit
```

The OS type must be `linux`. The SSH user must be able to run Docker without
interactive `sudo` from a remote shell.

## 2. Create/select SSH Docker context (Windows PowerShell)

```powershell
docker context create truck-log-linux --docker "host=ssh://deployuser@linux-host"
docker context use truck-log-linux
docker context show
docker info --format '{{.OSType}}'
docker compose version
```

Verify the active context is `truck-log-linux` and OS type is `linux`.
Do not open Docker TCP port 2375.

## 3. Extract the ZIP locally

The complete ZIP has a `TruckLog` top-level directory. For example,
extract it under `C:\Truck-Log` and open the app folder, `C:\Truck-Log\TruckLog\truck-log`.

## 4. Configure the operator-facing address

For a new `.env`, running the Windows setup with an SSH context now recognizes
`http://localhost:4300` as a template placeholder, and uses the SSH host DNS
name for `TRUCK_LOG_PUBLIC_ORIGIN`. If users will access a different DNS name,
custom port, or HTTPS reverse proxy, explicitly change `.env` before setup:

```ini
TRUCK_LOG_PUBLIC_ORIGIN=http://linux-host:4300
TRUCK_LOG_CORS_ORIGINS=http://linux-host:4300
```

Alternatively first run `SETUP-TRUCK-LOG.cmd -NoStart`, edit `.env`, then
run `SETUP-TRUCK-LOG.cmd` to build and start.

**Never upload or commit `.env`.** It contains generated passwords and secrets.

## 5. Deploy

```powershell
cd C:\Truck-Log\TruckLog\truck-log
.\SETUP-TRUCK-LOG.cmd
```

The installer lets Compose automatically create any missing named volumes/private network, builds images remotely, starts
services and waits for API and web health. Build times depend on host speed and
internet access; do not treat the six-minute health wait as an image-build limit.

## 6. Verify

```powershell
docker context show
docker compose ps
docker inspect --format '{{.State.Health.Status}}' truck-log-server
docker inspect --format '{{.State.Health.Status}}' truck-log-web
Test-NetConnection linux-host -Port 4300
Invoke-WebRequest 'http://linux-host:4300/' -UseBasicParsing
Invoke-RestMethod 'http://linux-host:4300/api/v1/health'
```

Open `http://linux-host:4300` in a browser. On a fresh database the Fort Wayne
nine-dock master is initialized by the baseline migration.

To inspect failures, use `LOGS-TRUCK-LOG.cmd`, or:

```powershell
docker compose logs --tail 150 truck-log-server
docker compose logs --tail 150 truck-log-web
```

## 7. Credentials and peripherals

- `SETUP-RXO-INTEGRATION-CREDENTIALS.cmd` (standard RXO)
- `SETUP-RXO-EXPEDITE-CREDENTIALS.cmd` (Expedite, separate credential)
- `BOOTSTRAP-RXO-BROWSER.cmd` (optional; Node.js 20+; remote SSH context opens
  an encrypted, temporary viewer tunnel for MFA)
- Windows physical Print Agent is installed/configured separately. It needs
  network reachability to the Truck Log web/API endpoint as designed.

Protect the Linux host and the application behind trusted network/VPN/HTTPS.
The Compose stack publishes the web listener on 4300 and API listener on 3334
unless firewall policy restricts them. PostgreSQL does not publish a host port.

## 8. Maintenance

- `STATUS-TRUCK-LOG.cmd`: view all current containers
- `LOGS-TRUCK-LOG.cmd`: follow logs
- `STOP-TRUCK-LOG.cmd`: stop containers while preserving data
- `START-TRUCK-LOG.cmd`: start existing stack

Don't run `docker compose down -v`, `docker volume prune`, or delete the eight
Truck Log volumes. These volumes contain production state and credentials.
Don't deploy a second Truck Log instance using these fixed container/volume
names onto a Linux Docker engine where one already runs.

If the Windows PC is retired, copy the *source package*, recreate its Docker
SSH context from the replacement PC, and **transfer the live `.env` securely**
if retaining that installation. The data remains on the Linux engine. Don't
run a fresh `.env` setup against an existing production database without
recovering the correct original secrets.

## Direct Compose commands on a Windows dev PC

In the extracted folder, the optional one-time `.env` initialization is:
`SETUP-TRUCK-LOG.cmd -NoStart` (creates a unique instance password and token).
Then `docker compose build` and `docker compose up -d` automatically create
the missing volumes and network. Preserve your old `.env` if reusing
the existing isolated test database; never commit or upload `.env`.
