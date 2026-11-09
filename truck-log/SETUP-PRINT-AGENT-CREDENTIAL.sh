#!/usr/bin/env sh
# Creates (or with --rotate, replaces) the credential a Print Agent PC uses.
#   ./SETUP-PRINT-AGENT-CREDENTIAL.sh --agent-id trucklog-print-pc-01 --name "Guard shack printer PC"
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
case "${1:-}" in
  ''|-h|--help) sed -n '2,3p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'FAIL: docker unavailable.' >&2; exit 1; }
. "$ROOT/tools/truck-log/compose-common.sh"
truck_log_resolve_compose || exit 1
truck_log_compose exec truck-log-server node tools/truck-log/provision-print-agent.mjs "$@"
printf '%s\n' 'Copy the token above into the Print Agent configuration now. It is not shown again.'
