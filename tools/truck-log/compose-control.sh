#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
. "$ROOT/tools/truck-log/compose-common.sh"
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'FAIL: docker was not found.' >&2; exit 1; }
truck_log_resolve_compose
case "${1:-}" in
  start) truck_log_assert_no_foreign_resources; truck_log_compose up -d ;;
  stop) truck_log_compose stop ;;
  status) truck_log_compose ps ;;
  logs) truck_log_compose logs --tail=250 -f ;;
  *) printf '%s\n' 'Usage: compose-control.sh start|stop|status|logs' >&2; exit 2 ;;
esac
