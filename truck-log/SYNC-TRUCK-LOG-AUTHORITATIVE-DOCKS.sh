#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
printf '\n============================================================\n'
printf ' TRUCK LOG - RESTORE AUTHORITATIVE DOCK MASTER\n'
printf '============================================================\n\n'
printf 'This makes public.docks match exactly the Fort Wayne 9-dock master:\n'
printf '  7, 25, 28, 41, 49, 52, 61, 62, 68\n'
printf 'A rollback-only database preflight runs before the real transaction.\n\n'
exec "$ROOT/tools/truck-log/run-reference-tool-in-docker.sh" sync-docks
