#!/usr/bin/env sh
set -eu

# Changes Truck Log passwords and secrets after the first-time setup.
# Never deletes data. No password is accepted as a command argument.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

usage() {
  cat <<'HELP'
Change Truck Log passwords and secrets (Linux Docker host).

  ./CHANGE-TRUCK-LOG-PASSWORDS.sh --admin           reset an administrator's sign-in password (prompts)
  ./CHANGE-TRUCK-LOG-PASSWORDS.sh --database        new database password: PostgreSQL + .env, then restart
  ./CHANGE-TRUCK-LOG-PASSWORDS.sh --print-secret    new Print Agent claim-token signing secret, then restart
  ./CHANGE-TRUCK-LOG-PASSWORDS.sh --rxo             change the standard RXO login
  ./CHANGE-TRUCK-LOG-PASSWORDS.sh --rxo-expedite    change the RXO Expedite login
  ./CHANGE-TRUCK-LOG-PASSWORDS.sh --all-generated   --database and --print-secret together (one restart)

Print PC token: ./SETUP-PRINT-AGENT-CREDENTIAL.sh --agent-id <id> --name "<name>" --rotate
--database also repairs a .env whose database password no longer matches PostgreSQL.
Generated values are written to .env only; they are never displayed.
HELP
}

fail() { printf '\nFAIL: %s\n' "$1" >&2; exit 1; }

case "${1:-}" in
  --admin|--database|--print-secret|--rxo|--rxo-expedite|--all-generated) ACTION=$1 ;;
  -h|--help|'') usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[ "$#" -eq 1 ] || { usage >&2; exit 2; }

case "$ACTION" in
  --admin) exec "$ROOT/SETUP-TRUCK-LOG-ADMIN.sh" --recover ;;
  --rxo) exec "$ROOT/SETUP-RXO-INTEGRATION-CREDENTIALS.sh" ;;
  --rxo-expedite) exec "$ROOT/SETUP-RXO-EXPEDITE-CREDENTIALS.sh" ;;
esac

command -v docker >/dev/null 2>&1 || fail 'docker was not found.'
. "$ROOT/tools/truck-log/compose-common.sh"
truck_log_resolve_compose || exit 1
[ -f .env ] || fail 'No .env in this folder. Run ./SETUP-TRUCK-LOG.sh first.'

hex32() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

get_env() {
  key=$1
  count=$(grep -c "^${key}=" .env 2>/dev/null || true)
  [ "$count" -le 1 ] || fail "Duplicate .env key: $key"
  grep "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2-
}

set_env() {
  key=$1 value=$2
  tmp=".env.$$.tmp"
  grep -v "^${key}=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

change_database_password() {
  user=$(get_env TRUCK_LOG_DATABASE_USERNAME)
  name=$(get_env TRUCK_LOG_DATABASE_NAME); name=${name:-TruckLog}
  # The role name is written into SQL below, so accept only a plain identifier.
  case "$user" in ''|*[!A-Za-z0-9_]*) fail 'TRUCK_LOG_DATABASE_USERNAME in .env must be a plain name (letters, digits, underscore).';; esac
  state=$(docker inspect --format '{{.State.Running}}' truck-log-postgres 2>/dev/null || true)
  [ "$state" = true ] || fail 'The truck-log-postgres container is not running. Run ./START-TRUCK-LOG.sh first.'
  new=$(hex32)
  printf '%s' "$new" | grep -Eq '^[0-9a-f]{64}$' || fail 'Could not generate a new password.'
  # Sent on standard input so the password never appears in a process list. The
  # connection is local inside the database container and does not need the old password.
  printf 'ALTER ROLE "%s" WITH PASSWORD '\''%s'\'';\n' "$user" "$new" |
    docker exec -i truck-log-postgres psql -v ON_ERROR_STOP=1 -q -U "$user" -d "$name" >/dev/null ||
    fail 'PostgreSQL did not accept the change. Nothing was changed; .env is untouched.'
  set_env TRUCK_LOG_DATABASE_PASSWORD "$new"
  printf '%s\n' '[PASS] Database password changed in PostgreSQL and .env.'
}

change_print_secret() {
  set_env TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET "$(hex32)"
  printf '%s\n' '[PASS] Print Agent claim-token signing secret replaced in .env.' \
    '       Print jobs claimed in the last few minutes are retried by their agent.'
}

case "$ACTION" in
  --database) change_database_password ;;
  --print-secret) change_print_secret ;;
  --all-generated) change_database_password; change_print_secret ;;
esac

printf '\n%s\n' '==> Restarting Truck Log with the new values (data volumes are kept)'
# An HTTPS installation must keep its overlay, or the restart would publish plain HTTP again.
if [ "$(get_env TRUCK_LOG_ADMIN_TRANSPORT)" = https ]; then
  truck_log_compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml up -d
else
  truck_log_compose up -d
fi
printf '\n%s\n' 'PASS - done. Check health with ./STATUS-TRUCK-LOG.sh.' \
  'If you deploy from a Windows PC, copy this .env over the one in its truck-log folder before the next deployment.'
