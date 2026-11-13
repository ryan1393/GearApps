#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
command -v node >/dev/null 2>&1 || { printf '%s\n' 'FAIL: Node.js 20+ is required on the workstation running RXO diagnostics.' >&2; exit 1; }
exec node tools/truck-log/new-host/collect-diagnostics.mjs "$@"
