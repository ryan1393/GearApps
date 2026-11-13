#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '\n==================================================\n  TRUCK LOG - RESET MOCK DATA\n==================================================\n\n'
printf '%s\n\n' 'Deletes only Truck Log mock records, then recreates the mock dataset.'
exec "$ROOT/tools/truck-log/run-mock-data-in-docker.sh" reset
