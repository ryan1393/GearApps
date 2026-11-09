#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

NO_START=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --no-start) NO_START=true ;;
    --skip-build) SKIP_BUILD=true ;;
    -h|--help)
      printf '%s\n' 'Usage: ./SETUP-TRUCK-LOG.sh [--no-start] [--skip-build]'
      exit 0
      ;;
    *) printf 'FAIL: unknown setup option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nFAIL: %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail 'docker was not found. Install Docker Engine/CLI first.'

. "$ROOT/tools/truck-log/compose-common.sh"
truck_log_resolve_compose || fail 'Docker Compose v2+ is required.'

OS_TYPE=$(docker info --format '{{.OSType}}' 2>/dev/null || true)
[ "$OS_TYPE" = linux ] || fail "Truck Log requires a reachable Linux Docker engine; got '${OS_TYPE:-unavailable}'."

hex32() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

get_env() {
  key=$1
  [ -f .env ] || return 0
  count=$(grep -c "^${key}=" .env 2>/dev/null || true)
  [ "$count" -le 1 ] || fail "Duplicate .env key: $key"
  grep "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2-
}

NL='
'
CR=$(printf '\r')
set_env() {
  key=$1 value=$2
  case "$value" in *"$NL"*|*"$CR"*) fail "Invalid multiline value for $key";; esac
  tmp=".env.$$.tmp"
  if [ -f .env ]; then grep -v "^${key}=" .env > "$tmp" || true; else : > "$tmp"; fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

printf '%s\n' '============================================================'
printf '%s\n' '  Truck Log - Linux Docker Setup'
printf '%s\n' '============================================================'
printf '%s\n' 'Safe setup: no database reset, no volume deletion, no Docker prune.'

log 'Checking for an older Truck Log install'
truck_log_assert_no_foreign_resources || exit 1
printf '%s\n' '[PASS] No containers or volumes from another Truck Log install.'

log 'Preparing .env'
[ -f .env.example ] || fail '.env.example is missing.'
if [ -f .env ]; then
  duplicate_key=$(sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env | sort | uniq -d | head -n 1)
  [ -z "$duplicate_key" ] || fail "Duplicate .env key: $duplicate_key"
fi
FRESH_ENV=false
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; FRESH_ENV=true; fi
DB_PASSWORD=$(get_env TRUCK_LOG_DATABASE_PASSWORD)
case "$DB_PASSWORD" in ''|CHANGE_ME|api) set_env TRUCK_LOG_DATABASE_PASSWORD "$(hex32)";; esac
CLAIM=$(get_env TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET)
if [ -z "$CLAIM" ]; then set_env TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET "$(hex32)";
elif ! printf '%s' "$CLAIM" | grep -Eq '^[0-9A-Fa-f]{64}$'; then fail 'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET must be 64 hexadecimal characters.'; fi
set_env TRUCK_LOG_DATABASE_HOST truck-log-postgres
set_env TRUCK_LOG_DATABASE_PORT 5432
set_env TRUCK_LOG_DATABASE_SYNCHRONIZE false
set_env TRUCK_LOG_RELEASE "$(tr -d '[:space:]' < VERSION)"

WEB_PORT=$(get_env TRUCK_LOG_WEB_PORT); WEB_PORT=${WEB_PORT:-4300}
case "$WEB_PORT" in ''|*[!0-9]*) fail "TRUCK_LOG_WEB_PORT must be a port number; got '$WEB_PORT'.";; esac
LOCAL_ORIGIN="http://localhost:${WEB_PORT}"
ORIGIN=$(get_env TRUCK_LOG_PUBLIC_ORIGIN)
if [ -z "$ORIGIN" ] || [ "$ORIGIN" = "$LOCAL_ORIGIN" ] || [ "$ORIGIN" = 'http://localhost:4300' ]; then
  HOSTNAME_VALUE=$(hostname -f 2>/dev/null || hostname 2>/dev/null || true)
  if [ -n "$HOSTNAME_VALUE" ] && [ "$HOSTNAME_VALUE" != localhost ]; then ORIGIN="http://${HOSTNAME_VALUE}:${WEB_PORT}"; else ORIGIN=$LOCAL_ORIGIN; fi
  set_env TRUCK_LOG_PUBLIC_ORIGIN "$ORIGIN"
fi
CORS=$(get_env TRUCK_LOG_CORS_ORIGINS)
if [ -z "$CORS" ] || [ "$CORS" = "$LOCAL_ORIGIN" ] || [ "$CORS" = 'http://localhost:4300' ]; then
  if [ "$ORIGIN" = "$LOCAL_ORIGIN" ]; then set_env TRUCK_LOG_CORS_ORIGINS "$ORIGIN"
  else set_env TRUCK_LOG_CORS_ORIGINS "$LOCAL_ORIGIN,$ORIGIN"
  fi
fi
printf '[PASS] Public origin: %s\n' "$ORIGIN"

# A brand-new .env with an existing database volume means the volume came from an
# earlier test build (different generated password). Stop instead of starting a
# server that cannot sign in to its own database.
if $FRESH_ENV && docker volume inspect truck-log-postgres-data >/dev/null 2>&1; then
  rm -f .env
  fail "An existing truck-log-postgres-data volume was found, but this folder has no .env.
It was created by another Truck Log install (for example a 0.1 test build) with a different password.
If you need that data, copy that install's .env into this folder and run setup again.
If it is only test data, run ./REMOVE-OLD-TRUCK-LOG-INSTALL.sh --all,
then run setup again."
fi

log 'Docker Compose will create/reuse all eight named volumes and its private network'
log 'Validating Compose configuration'
truck_log_compose config --quiet
printf '%s\n' '[PASS] Compose configuration is valid.'

if $NO_START; then
  printf '\n%s\n' '[PASS] Setup preparation complete. No containers were built or started.'
  printf '%s\n' 'Next: ./START-TRUCK-LOG.sh'
  exit 0
fi

log 'Building and starting Truck Log'
if $SKIP_BUILD; then truck_log_compose up -d
else truck_log_compose up -d --build
fi

log 'Waiting for core services to become healthy'
deadline=$(( $(date +%s) + 360 ))
server=''; web=''
while [ "$(date +%s)" -lt "$deadline" ]; do
  sleep 5
  server=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' truck-log-server 2>/dev/null || true)
  web=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' truck-log-web 2>/dev/null || true)
  printf '  API=%s  WEB=%s\n' "${server:-missing}" "${web:-missing}"
  [ "$server" = healthy ] && [ "$web" = healthy ] && break
done
[ "$server" = healthy ] && [ "$web" = healthy ] || { truck_log_compose ps || true; fail 'Core services did not become healthy. Run ./LOGS-TRUCK-LOG.sh.'; }

printf '\n%s\n' '============================================================'
printf '%s\n' 'PASS - TRUCK LOG INITIAL SETUP COMPLETE'
printf '%s\n' '============================================================'
printf 'Truck Log: %s\n' "$ORIGIN"
printf '%s\n' 'Standard RXO credentials: ./SETUP-RXO-INTEGRATION-CREDENTIALS.sh'
printf '%s\n' 'RXO Expedite credentials: ./SETUP-RXO-EXPEDITE-CREDENTIALS.sh'
printf '%s\n' 'If standard RXO requires interactive login/MFA: ./BOOTSTRAP-RXO-BROWSER.sh (requires Node.js 20+ on this workstation).'
printf '%s\n' 'No database or Docker volume was deleted.'
