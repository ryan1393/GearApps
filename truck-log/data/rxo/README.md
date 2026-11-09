# RXO local data boundary

`data/rxo/` is only the host-side/manual RXO staging boundary. Runtime Docker snapshots live in named volumes and are not shipped in this repository.

When `SYNC-RXO-LATEST-TO-TRUCK-LOG.cmd` is used, the verified six-file worker snapshot is staged under `data/rxo/latest/` and receives `truck-log-ingestion-boundary.json`. `IMPORT-RXO-LATEST.cmd` submits that verified boundary to `POST /api/v1/rxo/import-latest`, which transactionally imports the RXO snapshot into PostgreSQL.

The normal Docker RXO Control Center path copies the verified worker snapshot directly from the `truck-log-rxo-data` volume into the isolated `truck-log-rxo-import` volume, validates it, and performs the same database ingestion without requiring host-side files here.

Generated RXO snapshots are runtime data and remain excluded from the release package.
