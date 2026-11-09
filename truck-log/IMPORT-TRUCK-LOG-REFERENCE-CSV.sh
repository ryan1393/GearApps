#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
printf '\n============================================================\n'
printf ' TRUCK LOG - IMPORT REFERENCE DATA CSV\n'
printf '============================================================\n\n'
printf 'Source: reference-data-import/reference-data.csv\n'
printf 'The import is additive and runs a rollback-only database preflight.\n\n'
exec "$ROOT/tools/truck-log/run-reference-tool-in-docker.sh" import
