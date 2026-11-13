# Standard RXO worker

This directory contains the standard Fort Wayne RXO exporter/scheduler. The runtime is `src/rxo-scheduler.mjs` (scheduler) and `src/rxo-fort-wayne-export.mjs` (one export run, split into `src/lib/rxo-export-*.mjs`); shared auth, locking and retention code lives in `libs/truck-log/rxo-shared/`; `RUNTIME-MANIFEST.json` protects the current runtime files. Retired release-validation manifests are not shipped.

The worker requires both Fort Wayne identifiers (`12808` and `DANA_USA_FORT_WAYNE_IN`) and preserves Origin=OUTBOUND / Destination=INBOUND direction mapping. Credentials and browser state are runtime data stored in named Docker volumes, not in source.
