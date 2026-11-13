#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '\n==================================================\n  TRUCK LOG - LOAD MOCK DATA\n==================================================\n\n'
printf '%s\n\n' 'Adds only visibly tagged mock records and fake paperwork; existing real records are kept.'
exec "$ROOT/tools/truck-log/run-mock-data-in-docker.sh" seed
