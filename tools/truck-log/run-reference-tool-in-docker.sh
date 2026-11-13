#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
action=${1:-}
case "$action" in import|sync-docks|clear) ;; *) printf 'FAIL: invalid reference-data action: %s\n' "$action" >&2; exit 2 ;; esac
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'FAIL: Docker CLI was not found.' >&2; exit 1; }
running=$(docker inspect -f '{{.State.Running}}' truck-log-server 2>/dev/null || true)
[ "$running" = true ] || { printf '%s\n' 'FAIL: truck-log-server is not running. Start Truck Log first.' >&2; exit 1; }
docker exec truck-log-server node -e "require('fs').accessSync('/app/tools/truck-log/reference-csv/db-common.mjs')" >/dev/null 2>&1 || {
  printf '%s\n' 'FAIL: running server image is missing reference-data runtime tools. Rebuild truck-log-server.' >&2; exit 1;
}
case "$action" in
  import)
    file="$ROOT/reference-data-import/reference-data.csv"
    [ -f "$file" ] || { printf '%s\n' 'FAIL: reference-data-import/reference-data.csv not found. Copy the template and replace sample rows first.' >&2; exit 1; }
    docker exec -i truck-log-server node /app/tools/truck-log/reference-csv/import-reference-data-csv.mjs --stdin < "$file"
    ;;
  sync-docks)
    docker exec -i truck-log-server node /app/tools/truck-log/reference-csv/sync-authoritative-docks.mjs
    ;;
  clear)
    docker exec -i truck-log-server node /app/tools/truck-log/reference-csv/clear-truck-log-data.mjs
    ;;
esac
