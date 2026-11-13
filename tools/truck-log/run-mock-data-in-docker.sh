#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
action=${1:-}
case "$action" in seed|reset|clear|status) ;; *) printf 'FAIL: invalid mock-data action: %s\n' "$action" >&2; exit 2 ;; esac
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'FAIL: Docker CLI was not found.' >&2; exit 1; }
context=$(docker context show 2>/dev/null || true)
[ -n "$context" ] || { printf '%s\n' 'FAIL: could not determine the active Docker context.' >&2; exit 1; }
printf '[INFO] Docker context: %s\n' "$context"
running=$(docker inspect -f '{{.State.Running}}' truck-log-server 2>/dev/null || true)
[ "$running" = true ] || { printf '%s\n' 'FAIL: truck-log-server is not running. Start/rebuild Truck Log first.' >&2; exit 1; }
docker exec truck-log-server node -e "require('fs').accessSync('/app/tools/truck-log/mock-data.mjs')" >/dev/null 2>&1 || {
  printf '%s\n' 'FAIL: the running server image is missing the mock-data runtime tool. Rebuild truck-log-server and retry.' >&2
  exit 1
}
printf '[INFO] Running mock-data action "%s" inside truck-log-server.\n\n' "$action"
docker exec -i truck-log-server node /app/tools/truck-log/mock-data.mjs "$action"
printf '\n[PASS] Mock-data action "%s" completed inside truck-log-server.\n' "$action"
