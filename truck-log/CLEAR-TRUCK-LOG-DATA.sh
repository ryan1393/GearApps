#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
printf '\n============================================================\n'
printf ' TRUCK LOG - CLEAR OPERATIONAL / RXO / REFERENCE DATA\n'
printf '============================================================\n\n'
printf '%s\n' 'WARNING: This can permanently clear visits, scheduled loads, standard/Expedite RXO rows,'
printf '%s\n\n' '         reusable reference data, and docks from the Truck Log PostgreSQL database.'
printf '%s\n' 'It preserves app/plant settings, users/auth, and schema metadata.'
printf '%s\n\n' 'The database tool first runs a rollback-only safety preflight. Only after that passes will it ask you to type CLEAR.'
"$ROOT/tools/truck-log/run-reference-tool-in-docker.sh" clear
printf '\nClear operation finished. Review the output above to confirm whether it was committed or cancelled.\n'
printf '%s\n' 'Run ./SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.sh if you intentionally cleared docks and want the Fort Wayne dock master restored.'
