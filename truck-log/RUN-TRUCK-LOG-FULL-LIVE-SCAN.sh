#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
printf '%s\n' '============================================================'
printf '%s\n' ' TRUCK LOG FULL LIVE SCAN - READ ONLY'
printf '%s\n' '============================================================'
printf '%s\n\n' 'This scan does not modify source, containers, images, volumes, PostgreSQL, RXO data, credentials, or networks.'
command -v node >/dev/null 2>&1 || { printf '%s\n' 'FAIL: Node.js 20+ is required for this optional workstation diagnostic.' >&2; exit 1; }
exec node tools/truck-log/full-live-scan.mjs
