# Lapper Read (Python, Docker)

Collects lapping runs from a FANUC controller and its barcode scanner and publishes them
to the GearApps API. It is a Python port of the Windows `apps/lapper-read` service and
uses the same API endpoints, so the Lapper screens work unchanged.

One container watches one lapper:

1. **Controller**: reads macro #10020 (gearset number), #10032 (consec) and the PMC
   signals X6.7 front door, X1.2 cycle start and Y3.2 in cycle over FOCAS (TCP 8193).
2. **Scanner**: reads the part serial on input 1 (TCP 9004).
3. **Run complete** (door opens after a cycle): captures every macro in Lapper → Macros,
   writes the run to disk, then posts it with an Idempotency-Key.
4. **Change log**: only macros whose value changed since the previous run of that
   gearset on that machine are posted, so each run records what changed.
5. **Live view**: keeps the scanner serials and Fanuc I/O on the Lapper live view current.

A run without a confirmed scanned serial is never recorded under a substitute serial.
Unsent runs stay in `/data` and are retried after network or API outages and restarts.

## Requirements

- FANUC's licensed **Linux** FOCAS library, `libfwlib32.so` (64-bit x86 build), in
  `apps/lapper-read-py/fanuc/`. It is mounted read-only into the container and is never
  committed or baked into the image. See `fanuc/README.md`.
- The machine and its scanner set up in Lapper (Machines, and Configuration → Scanners
  with the scanner assigned to the machine).
- An active GearApps account for the collector. It does not need admin rights.
- Network access from the Docker host to the controller (8193) and scanner (9004).

## Run

Set the `LAPPER_READ_*` values in `.env` (see `.env.example`), then:

    docker compose --profile collectors up -d --build lapper-read
    docker compose logs -f lapper-read

Check the controller connection without the API or scanner:

    docker compose --profile collectors run --rm lapper-read check 10021 11006

### More lappers

Copy the `lapper-read` service in `compose.yml` once per machine, giving each copy its own
name, `LAPPER_MACHINE_IP` / `LAPPER_SCANNER_IP` values and its own state volume.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LAPPER_MACHINE_IP` | required | FANUC controller IP |
| `LAPPER_MACHINE_NUMBER` | | Asset number, when machines share an IP |
| `LAPPER_SCANNER_IP` | required | Scanner IP |
| `LAPPER_SCANNER_INPUT1_PORT` | 9004 | Scanner command port |
| `FOCAS_PORT` | 8193 | FOCAS port |
| `FOCAS_LIBRARY` | /opt/fanuc/libfwlib32.so | Library path inside the container |
| `LAPPER_POLL_INTERVAL_MS` | 250 | Machine/scanner poll period |
| `LAPPER_RETRY_DELAY_MS` | 5000 | Wait after a failure |
| `LAPPER_IO_TIMEOUT_MS` | 3000 | Controller/scanner timeout |
| `LAPPER_STATE_DIR` | /data | Checkpoint, heartbeat and FOCAS log |
| `GEARAPPS_API_BASE_URL` | http://gear-app-server:3333 | Shared GearApps API |
| `GEARAPPS_API_EMAIL` / `GEARAPPS_API_PASSWORD` | required | Collector account |

The container is healthy while it is reading the controller (a heartbeat in `/data`).

## Develop

No third-party packages are needed. Tests use simulated controllers, scanners and APIs:

    npx nx test lapper-read-py

Test on a real lapper before relying on it in production. The automated tests can't
confirm controller timing or that your FANUC library version is compatible.
