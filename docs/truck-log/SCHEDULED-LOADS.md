# Scheduled Loads

Truck Log uses `scheduled_loads` as the only authority for `truck_visits.scheduled_at`.

## Rule

- The guard cannot type Scheduled Time.
- Load Number is required for every new truck visit.
- The API performs a case-insensitive exact lookup of the required Load Number against an active `scheduled_loads` row.
- If a match exists, the row's `scheduled_at` is copied into the new truck visit.
- If no match exists, the new visit stores `scheduled_at = NULL`.
- PostgreSQL trigger `trg_truck_visits_scheduled_source` rejects new non-null visit schedules that are not backed by the scheduled-load table.

## Table

```text
scheduled_loads
  id
  load_number
  scheduled_at
  active
  source
  created_at
  updated_at
```

Only one active scheduled row may exist for a given load number, case-insensitive.

## Operator preview

Check-In can preview the schedule with:

```text
GET /api/v1/scheduled-loads/lookup?loadNumber=<LOAD>
```

The preview is informational. Visit creation performs the authoritative lookup again on the server.

## Manual test example

Use a clearly fake load number when testing:

```sql
INSERT INTO scheduled_loads(load_number, scheduled_at, active, source)
VALUES ('TEST-SCHED-001', '2026-08-26 08:00:00-04', TRUE, 'MANUAL-TEST');
```

Then enter `TEST-SCHED-001` as Load Number on Check-In. The scheduled time should preview and the created visit should receive that value.

For a load number not present in `scheduled_loads`, Check-In should show that the visit is unscheduled and the saved `truck_visits.scheduled_at` should be `NULL`.

The external/import feed that populates production scheduled loads is a separate integration step.


## Check-In routing contract

Load Number is required for every new truck visit.

Drop Trailer defaults to **No**. The guard changes it to **Yes** only when the trailer is being dropped.

Plant-side routing is direction-driven:

- **Outbound:** Origin is auto-filled from `app_settings.plant_location_name` (default `Fort Wayne`); the guard enters Destination.
- **Inbound:** Destination is auto-filled from `app_settings.plant_location_name` (default `Fort Wayne`); the guard enters Origin.

The API re-applies the plant-side rule during create, so it cannot be bypassed by a browser/client.
