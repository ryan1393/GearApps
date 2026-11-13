#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
action=${1:-}
case "$action" in start|status|logs) ;; *) printf 'FAIL: invalid RXO control action: %s\n' "$action" >&2; exit 2 ;; esac
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'FAIL: Docker CLI was not found.' >&2; exit 1; }
. "$ROOT/tools/truck-log/compose-common.sh"
truck_log_resolve_compose
case "$action" in
  start) truck_log_compose up -d --build rxo-export; truck_log_compose ps rxo-export ;;
  status) truck_log_compose ps rxo-export; truck_log_compose logs --tail=80 rxo-export ;;
  logs) truck_log_compose logs -f rxo-export ;;
esac
