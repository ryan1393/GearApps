#!/usr/bin/env sh
set -eu

# Explicit, interactive local administrator maintenance on the Docker host.
# Not part of automatic setup. Does not touch RXO credentials or worker state.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

usage() {
  cat <<'HELP'
Truck Log administrator account setup (Linux Docker host).

  ./SETUP-TRUCK-LOG-ADMIN.sh --bootstrap # first user, prompts for password
  ./SETUP-TRUCK-LOG-ADMIN.sh --verify    # verify schema
  ./SETUP-TRUCK-LOG-ADMIN.sh --recover   # existing account recovery only

Operations require a local interactive terminal. No passwords on command line.
The admin tables are created automatically; this only manages accounts.
HELP
}
case "${1:-}" in
  --bootstrap|--verify|--recover) ACTION=$1 ;;
  -h|--help|'') usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[ "$#" -eq 1 ] || { usage >&2; exit 2; }
[ -t 0 ] && [ -t 1 ] || { printf '%s\n' 'FAIL: use an interactive terminal (SSH with -t if needed).' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'FAIL: docker unavailable.' >&2; exit 1; }
. "$ROOT/tools/truck-log/compose-common.sh"
truck_log_resolve_compose || exit 1
[ "$(docker info --format '{{.OSType}}' 2>/dev/null || true)" = linux ] || { printf '%s\n' 'FAIL: Linux Docker engine required.' >&2; exit 1; }
[ -f "$ROOT/.env" ] || { printf '%s\n' 'FAIL: run SETUP-TRUCK-LOG.sh first.' >&2; exit 1; }

# Do not use exec -T: the utility explicitly requires a TTY to read passwords.
truck_log_compose exec truck-log-server \
  node tools/truck-log/admin-accounts.cjs "$ACTION"
