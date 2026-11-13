#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '\n==================================================\n  TRUCK LOG - CLEAR MOCK DATA\n==================================================\n\n'
printf '%s\n\n' 'Deletes only Truck Log mock records and mock paperwork; real records are not targeted.'
exec "$ROOT/tools/truck-log/run-mock-data-in-docker.sh" clear
