#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '\n==================================================\n  TRUCK LOG - MOCK DATA STATUS\n==================================================\n\n'
exec "$ROOT/tools/truck-log/run-mock-data-in-docker.sh" status
