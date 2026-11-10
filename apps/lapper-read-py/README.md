# Lapper Read (Python, Docker)

Collects lapping runs from a FANUC controller and its barcode scanner and publishes them
to the GearApps API. It is a Python port of the Windows `apps/lapper-read` service and
uses the same API endpoints, so the Lapper screens work unchanged.

## Workers follow the machines saved in Lapper

One container runs a **supervisor**. Every 30 seconds it reads Lapper's machines and keeps
exactly one worker running for each machine that is:

- **Active**, and
- has a **FANUC controller IP** (Admin → Lapping Machines).

A machine with an **Active scanner assigned** (Configuration → Scanners) records each run
under its scanned serial. A machine without one still records every completed run (gearset,
consec, time and changed macros) with **no serial**; assign a scanner later and new runs get
serials. Saving a new machine starts its worker. Changing its controller IP, asset number or
scanner restarts the worker with the new settings. Making it Inactive, clearing the IP, or
deleting it stops the worker. Each worker keeps its unsent runs under the
machine's GearApps id, so they survive IP changes and restarts. A worker that fails is
rebuilt after a pause without touching the others.

The Lapper **Fanuc Variables** page shows every machine's worker: Collecting (with the
last read time and any runs waiting to send), Controller unavailable, or No worker and why.
Full detail, including IPs and errors, is at `http://<docker-host>:8090/status`.

### What each worker does

1. **Controller**: reads macro #10020 (gearset number), #10032 (consec) and the PMC
   signals X6.7 front door, X1.2 cycle start and Y3.2 in cycle over FOCAS (TCP 8193).
2. **Scanner**: reads the part serial on input 1 (TCP 9004).
3. **Run complete** (door opens after a cycle): captures every macro in Lapper → Macros,
   writes the run to disk, then posts it with an Idempotency-Key.
4. **Change log**: only macros whose value changed since the previous run of that
   gearset on that machine are posted, so each run records what changed.
5. **Live view**: keeps the scanner serials and Fanuc I/O on the Lapper live view current.

On a machine with a scanner, a run without a confirmed scanned serial is never recorded
under a substitute serial. Machines without a scanner record runs with no serial.
Unsent runs stay in `/data` and are retried after network or API outages and restarts.

## Requirements

- FANUC's licensed **Linux** FOCAS library, `libfwlib32.so` (64-bit x86 build), in
  `apps/lapper-read-py/fanuc/`. It is mounted read-only into the container and is never
  committed or baked into the image. See `fanuc/README.md`.
- Each lapper saved in Lapper as described above.
- A **collector token**: in Lapper, an admin opens Configuration → Collector Tokens and
  creates one. It never expires, can only send machine data, and is revoked from the same
  page. An active GearApps account (email and password) also works.
- Network access from the Docker host to the controller (8193) and scanner (9004).

## Run

Set `LAPPER_READ_API_TOKEN` in `.env` (or `LAPPER_READ_API_EMAIL` and
`LAPPER_READ_API_PASSWORD`; see `.env.example`), then:

    docker compose --profile collectors up -d --build lapper-read
    docker compose logs -f lapper-read

After that, adding or editing machines in Lapper is all it takes. There is nothing to
change in Docker per machine.

Check one controller connection without the API or scanner:

    docker compose --profile collectors run --rm -e LAPPER_MACHINE_IP=10.16.81.15 lapper-read check 10021 11006

`python -m lapper_read run` (with `LAPPER_MACHINE_IP` and `LAPPER_SCANNER_IP`) still runs a
single worker without the supervisor.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LAPPER_DISCOVER_INTERVAL_S` | 30 | How often saved machines are re-read |
| `LAPPER_STATUS_PORT` | 8080 | Status port in the container (0 turns it off) |
| `LAPPER_MACHINE_IP` / `LAPPER_SCANNER_IP` | | Only for the single-machine `run` and `check` commands |
| `LAPPER_MACHINE_NUMBER` | | `run` only: asset number when machines share an IP |
| `LAPPER_SCANNER_INPUT1_PORT` | 9004 | Scanner command port |
| `FOCAS_PORT` | 8193 | FOCAS port |
| `FOCAS_LIBRARY` | /opt/fanuc/libfwlib32.so | Library path inside the container |
| `LAPPER_POLL_INTERVAL_MS` | 250 | Machine/scanner poll period |
| `LAPPER_RETRY_DELAY_MS` | 5000 | Wait after a failure |
| `LAPPER_IO_TIMEOUT_MS` | 3000 | Controller/scanner timeout |
| `LAPPER_STATE_DIR` | /data | Checkpoint, heartbeat and FOCAS log |
| `GEARAPPS_API_BASE_URL` | http://gear-app-server:3333 | Shared GearApps API |
| `GEARAPPS_API_TOKEN` | | Collector token (`glr_…`); replaces email and password |
| `GEARAPPS_API_EMAIL` / `GEARAPPS_API_PASSWORD` | | Collector account, when no token is set |

The container is healthy while the supervisor keeps reading the machine list.

## Develop

No third-party packages are needed. Tests use simulated controllers, scanners and APIs:

    npx nx test lapper-read-py

Test on a real lapper before relying on it in production. The automated tests can't
confirm controller timing or that your FANUC library version is compatible.
