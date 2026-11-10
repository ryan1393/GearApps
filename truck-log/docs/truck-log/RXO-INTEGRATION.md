# Truck Log RXO Integration

## Architecture

Standard RXO acquisition and Truck Log ingestion are separate responsibilities:

```text
RXO Connect browser/export
        |
        v
rxo-export Docker worker
(truck-log-rxo-data)
        | verified six-file snapshot
        v
Truck Log RXO control/sync boundary
(truck-log-rxo-import)
        |
        v
PostgreSQL RXO tables + scheduled-load context
```

The source application is `apps/rxo-integration`; the API-side ingestion implementation is under `libs/truck-log/server/feature/rxo-ingestion/src/lib`. RXO supplies planned/transportation context and does not replace the physical Truck Log lifecycle `DOCK_ASSIGNED -> DOCK_COMPLETE -> GUARD_CHECKED_OUT`.

## Fort Wayne acquisition contract

The standard worker requires both Fort Wayne identifiers:

```text
12808
DANA_USA_FORT_WAYNE_IN
```

Direction mapping is fixed:

```text
Origin      = OUTBOUND
Destination = INBOUND
```

Each completed acquisition publishes Orders, Freight On The Move, and Shipments for both directions. The worker verifies all six XLSX files and its source manifest before reporting success.

The active-load window is fixed: yesterday, today and tomorrow in Fort Wayne time (`America/Indiana/Indianapolis`). Uncapped exports are retained in full, including records outside that window. When Orders or Shipments reaches RXO's row limit, verified date-range exports cover the active window instead: Orders use the direction's Pickup/Delivery Date; Shipments combine the corresponding Appointment and Estimated Arrival date exports. Freight On The Move remains live. The Control Center reports this fixed plan and lets administrators change only the scan interval and timeout limits. Legacy `operationalLookbackDays` / `operationalLookaheadDays` keys from earlier releases never affected acquisition; they are ignored on read and removed when settings are next saved. The control status returns the read-only active/date-fallback plan as `exportWindow`.

`apps/rxo-integration/RUNTIME-MANIFEST.json` records the expected hashes of the protected runtime files. `node tools/truck-log/rxo/validate-rxo-integration.mjs` fails if those files drift without an intentional manifest refresh.

## Docker state and credentials

The standard worker uses these persistent volumes:

```text
truck-log-rxo-data
truck-log-rxo-state
truck-log-rxo-credentials
```

Credentials and browser-session state are runtime data and are not shipped in the source package. Configure credentials with `SETUP-RXO-INTEGRATION-CREDENTIALS.cmd` on Windows or `SETUP-RXO-INTEGRATION-CREDENTIALS.sh` on Linux.

## Current automated flow

The Truck Log RXO Control Center can request a scan or synchronize the worker's verified `latest` snapshot. The API copies the snapshot from `truck-log-rxo-data` into the isolated `truck-log-rxo-import` volume, validates the boundary, and then imports it into PostgreSQL.

The database ingestion is transactional and idempotent by site/batch identity and boundary digest. It writes/refreshes:

- `rxo_import_batches`
- `rxo_orders`
- `rxo_shipments`
- `rxo_freight_visibility`
- `rxo_order_shipment_links`
- `rxo_shipment_context` view
- RXO-backed `scheduled_loads` rows

The import parses and validates the six source workbooks before the atomic database write phase. Incomplete/unverified source directions are surfaced as partial health instead of being treated as complete.

Workbook parsing preserves populated rows after blank rows and splits multiline Shipment order-ID cells before normalizing identifiers. Blank rows do not count toward the 25,000 populated-data-row limit.

Primary API routes are:

```text
GET   /api/v1/rxo/status
POST  /api/v1/rxo/import-latest
GET   /api/v1/rxo/data
GET   /api/v1/rxo/orders
GET   /api/v1/rxo/shipments
GET   /api/v1/rxo/shipments/:shipmentId
GET   /api/v1/rxo/control
PATCH /api/v1/rxo/control/settings
POST  /api/v1/rxo/control/rescan
POST  /api/v1/rxo/control/sync-latest
```

## Manual/admin helpers

### Scan Now in the webpage

Sign in as a Truck Log administrator and open **RXO Control Center** (`/rxo`) or **RXO Expedite** (`/rxo-expedite`). Select **Scan Now** to queue one export in that integration's existing scheduler. The two integrations have separate scan requests and status.

The button is unavailable while the integration is already scanning or its scheduler cannot accept a request. An authentication hold still requires corrected credentials or the indicated interactive sign-in; **Scan Now** does not clear that hold. Use **Recover connection** when connection recovery is needed.

A queued request confirms only that the scheduler accepted the request. Watch the scan state and **Last successful export** for the export result, then **Latest import** for the database result. Export completion can appear before the imported batch changes. A failed export keeps the previous verified batch available.

The administrator-only endpoints are `POST /api/v1/rxo/control/rescan` and `POST /api/v1/rxo/expedite/rescan`. They retain the application's session, origin, intent-header, and CSRF protections.

### Command-line helpers

The included root helpers remain useful for diagnostics or controlled manual operation:

```text
TEST-RXO-INTEGRATION.cmd
START-RXO-INTEGRATION.cmd
STATUS-RXO-INTEGRATION.cmd
VERIFY-RXO-INTEGRATION-LATEST.cmd
SYNC-RXO-LATEST-TO-TRUCK-LOG.cmd
IMPORT-RXO-LATEST.cmd
```

`SYNC-RXO-LATEST-TO-TRUCK-LOG.cmd` is the host-side bridge used when an administrator intentionally stages the worker snapshot into `data/rxo/latest/`. Its validator requires the same six datasets and writes `truck-log-ingestion-boundary.json`; `IMPORT-RXO-LATEST.cmd` then calls the API import route. The normal Docker control path uses the named import volume instead of requiring this host-side copy.

## Database ownership

The standard RXO tables are part of `database/truck-log/migrations/0001_baseline.sql`, applied automatically at server start (see `DATABASE-MIGRATIONS.md`).

## RXO Expedite: empty Freight on the Move list

RXO shows "0 of 0 Shipments" while Freight on the Move is still loading, so a scheduled Expedite scan does not trust an empty list at first sight when an earlier batch held shipments.

- The scan waits for RXO's loading overlay to clear and for the count to stay at zero for 20 seconds before exporting.
- The first empty export is recorded and reported as `EMPTY_LIST_AWAITING_SECOND_SCAN`; the previous batch stays published.
- A second empty export at least ten minutes later, and within six hours, publishes the empty list. Any scan that finds shipments in between cancels the first sighting.
- While the empty list remains the published batch, later empty scans publish normally. Shipments returning reset the rule.

The manual one-off Expedite run (`rxo-expedite-manual` profile) publishes whatever it exports, as before.
