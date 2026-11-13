# Truck Log Reference CSV Import

`reference-data-template.csv` is a format example only. Copy it to `reference-data.csv`, replace the sample rows with the data you intend to import, then run:

`IMPORT-TRUCK-LOG-REFERENCE-CSV.cmd` (Windows) or `./IMPORT-TRUCK-LOG-REFERENCE-CSV.sh` (Linux)

## CSV format

```csv
Type,Name,Phone,State
Driver,John Smith,2605551212,
Carrier,Example Logistics,,
Location,Indianapolis,,IN
Origin,Detroit,,MI
Destination,Fort Wayne,,IN
```

`Origin` and `Destination` become reusable Location records. Driver Phone is optional; when supplied it is normalized to digits and must contain 7–15 digits.

The importer performs the complete insert/verification path first in a rollback-only transaction and commits only after that preflight succeeds.

## Dock master

A fresh Truck Log database is seeded with the authoritative Fort Wayne dock master (7, 25, 28, 41, 49, 52, 61, 62, 68). The reference-data CSV importer does not manage docks. Use `SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd` / `.sh` only when you intentionally want to restore that exact dock master.

## Destructive reset

`CLEAR-TRUCK-LOG-DATA.cmd` / `.sh` clears operational visits, scheduled loads, standard/Expedite RXO rows, reusable reference data, **and docks**. It preserves app/plant settings, users/auth, and schema metadata. The tool runs a rollback-only preflight and requires typing `CLEAR` before the real transaction.


All three maintenance helpers execute inside the running `truck-log-server` container, so host Node.js is not required.
