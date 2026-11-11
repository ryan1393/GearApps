# Lapper Read (Python, Docker)

Collects lapping runs from a FANUC controller and its barcode scanner and publishes them
to the MeshForge API. It replaced the earlier Windows (.NET) Lapper Read service, which is
no longer in this repository, and uses the same API endpoints.

## Workers follow the machines saved in Lapper

One container runs a **supervisor**. Every 30 seconds it reads Lapper's machines and keeps
exactly one worker running for each machine that is:

- **Active**, and
- has a **FANUC controller IP** (Admin → Lapping Machines).

Every completed run is recorded (gearset, consec, time and changed macros). It gets the scanned
serial when the machine has an **Active scanner assigned** (Configuration → Scanners) that is
online; with no scanner, an offline scanner, or nothing scanned, it is recorded with **no serial**.
An offline scanner is pinged and its port retried in the background every 30 seconds, so it never
slows the machine polling; serials resume by themselves when it answers. The FANUC Variables page
shows each scanner as Online, Offline (and whether it answers ping) or No scanner, and an idle
control (no program loaded, so #10020 or #10032 is 0) as No gearset loaded until a program runs. Saving a new machine starts its worker. Changing its controller IP, asset number or
scanner restarts the worker with the new settings. Making it Inactive, clearing the IP, or
deleting it stops the worker. Each worker keeps its unsent runs under the
machine's MeshForge id, so they survive IP changes and restarts. A worker that fails is
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

A run is never recorded under a substitute serial: without a confirmed scan it has no serial.
Unsent runs stay in `/data` and are retried after network or API outages and restarts.

## Requirements

- FANUC's licensed **Linux** FOCAS library, `libfwlib32.so` (64-bit x86 build), in
  `apps/lapper-read-py/fanuc/`. It is mounted read-only into the container and is never
  committed or baked into the image. See `fanuc/README.md`.
- Each lapper saved in Lapper as described above.
- A **connected collector**: in Lapper, an admin opens Configuration → Collector Tokens and
  clicks **Connect Docker collector**. The API writes a new collector token to a private
  volume shared only with this container (`/run/meshforge/collector/token`) and revokes the
  previous one; the collector reads it there and picks up a replacement by itself. The token
  never expires, can only send machine data, is never shown, and is revoked from the same page.
  `LAPPER_READ_API_TOKEN` (a pasted token) or an account's email and password still override it.
- Network access from the Docker host to the controller (8193) and scanner (9004).

## Run

Click **Connect Docker collector** in Lapper (nothing to put in `.env`), then:

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
| `MESHFORGE_API_BASE_URL` | http://meshforge-server:3333 | Shared MeshForge API |
| `MESHFORGE_API_TOKEN` | | Collector token (`glr_…`); replaces email and password |
| `MESHFORGE_API_EMAIL` / `MESHFORGE_API_PASSWORD` | | Collector account, when no token is set |
| `ARGONAUT_ENABLED` | false | Also send each finished cycle to Argonaut (see below) |
| `ARGONAUT_URL` | | Argonaut `trigger-transaction` URL (required when enabled) |
| `ARGONAUT_LOCATION_ID` | | Sent as `?locationId=` |
| `ARGONAUT_USERNAME` / `ARGONAUT_PASSWORD` | | Basic sign-in; empty sends no Authorization header |
| `ARGONAUT_TRANSACTION_TYPE_ID` | 100 | Track and Trace transaction type |
| `ARGONAUT_VERIFY_TLS` | true | `false` accepts a self-signed certificate |
| `ARGONAUT_CA_FILE` | | CA/certificate file to trust instead of turning verification off |
| `ARGONAUT_TIMEOUT_S` | 10 | Request timeout |

In Docker these are set from the `LAPPER_READ_ARGONAUT_*` entries in `.env`.

## Argonaut

Ported from the original C# Lapper Read. With `ARGONAUT_ENABLED=true`, when a cycle finishes
(machine out of cycle and front door open) the worker reads Argonaut's FANUC macros once and
posts them to `ARGONAUT_URL`: the scanned serial, gearset (`#10020`) as the part number, the
cycle's consec as the sequence, 63 macros as `floatData` (after a leading 0) and `#10020`,
`#10021`, `#10023`, `#10400`, `#10480` as `stringData`. A macro the controller does not answer
is sent as 0, as before. The macro list is in `lapper_read/argonaut.py`.

- **Per machine:** in Admin > Lapping machines, paste each machine's full **Argonaut API**
  address, including `?locationId=…`. A machine with an address sends to it exactly as pasted,
  even when `ARGONAUT_ENABLED` is off. Sign-in, TLS and timeout stay the collector's. Leave it
  empty to use the collector default. Changing it restarts that machine's worker within
  `LAPPER_DISCOVER_INTERVAL_S`. A `locationId` already in a URL is never replaced by
  `ARGONAUT_LOCATION_ID`.
- Argonaut has its own queue in the machine's checkpoint, so an Argonaut outage never holds up
  recording cycles in MeshForge. Failed posts are retried with a growing delay (up to 5
  minutes) and survive restarts; at most 1000 unsent cycles are kept per machine.
- A request Argonaut rejects as invalid (HTTP 4xx other than 401/403/408/429) is logged and not
  retried. A cycle with no scanned serial is not sent.
- `/status` shows `argonaut`, `argonaut_pending`, `argonaut_last_sent_at` and `argonaut_last_error`
  for each machine.
- **Test without a machine:** Admin > Cycle Test Lab > Send to Argonaut sends one transaction built
  the same way (`buildArgonautPayload` in `libs/shared/domain`; keep its macro lists in step with
  `lapper_read/argonaut.py`) from the API, using these same `LAPPER_READ_ARGONAUT_*` settings.

The container is healthy while the supervisor keeps reading the machine list.

## Develop

No third-party packages are needed. Tests use simulated controllers, scanners and APIs:

    npx nx test lapper-read-py

Test on a real lapper before relying on it in production. The automated tests can't
confirm controller timing or that your FANUC library version is compatible.
