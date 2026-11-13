#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
command -v node >/dev/null 2>&1 || { echo '[FAIL] Node.js 20+ is required on the workstation running the interactive browser helper.' >&2; exit 1; }
MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
[ "$MAJOR" -ge 20 ] || { echo "[FAIL] Node.js 20+ is required; found $(node --version 2>/dev/null || echo unknown)." >&2; exit 1; }
exec node tools/truck-log/new-host/browser-bootstrap.mjs "$@"
