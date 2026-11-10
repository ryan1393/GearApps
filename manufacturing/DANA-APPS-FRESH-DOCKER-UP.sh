#!/usr/bin/env bash
set -euo pipefail

MANUFACTURING_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$MANUFACTURING_ROOT/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[FAIL] .env is missing. Copy .env.example to .env and set the required secrets first." >&2
  exit 1
fi

get_env() {
  local key="$1" raw
  raw="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  raw="${raw%$'\r'}"
  if [[ "$raw" == \"*\" && "$raw" == *\" ]]; then raw="${raw:1:${#raw}-2}"; fi
  if [[ "$raw" == \'*\' && "$raw" == *\' ]]; then raw="${raw:1:${#raw}-2}"; fi
  printf '%s' "$raw"
}

require_secret() {
  local key="$1" min="$2" value
  value="$(get_env "$key")"
  if [[ -z "$value" ]]; then
    echo "[FAIL] .env is missing a value for ${key}." >&2
    exit 1
  fi
  if [[ "$value" == replace-* || "$value" == change-* || "$value" == *"replace-this"* ]]; then
    echo "[FAIL] ${key} still contains a placeholder value." >&2
    exit 1
  fi
  if (( ${#value} < min )); then
    echo "[FAIL] ${key} must be at least ${min} characters." >&2
    exit 1
  fi
}

require_secret GEAR_DB_PASSWORD 12
require_secret SEED_ADMIN_PASSWORD 12
require_secret SEED_USER_PASSWORD 12
require_secret JWT_ACCESS_SECRET 16
require_secret JWT_REFRESH_SECRET 16

GEAR_API_PORT="$(get_env GEAR_API_PORT)"; GEAR_API_PORT="${GEAR_API_PORT:-3333}"
GEAR_BLADE_UI_PORT="$(get_env GEAR_BLADE_UI_PORT)"; GEAR_BLADE_UI_PORT="${GEAR_BLADE_UI_PORT:-4200}"
GEAR_CUTTER_UI_PORT="$(get_env GEAR_CUTTER_UI_PORT)"; GEAR_CUTTER_UI_PORT="${GEAR_CUTTER_UI_PORT:-4201}"
GEAR_GREENSHED_UI_PORT="$(get_env GEAR_GREENSHED_UI_PORT)"; GEAR_GREENSHED_UI_PORT="${GEAR_GREENSHED_UI_PORT:-4202}"
DANA_POSTGRES_VOLUME_NAME="$(get_env DANA_POSTGRES_VOLUME_NAME)"; DANA_POSTGRES_VOLUME_NAME="${DANA_POSTGRES_VOLUME_NAME:-dana-apps-gear-postgres}"

echo "Dana Apps fresh Docker host"
echo "  Gear DB volume: ${DANA_POSTGRES_VOLUME_NAME}"
echo "  Runtime DATABASE_SYNCHRONIZE: false"
echo

if docker volume inspect "$DANA_POSTGRES_VOLUME_NAME" >/dev/null 2>&1; then
  echo "[INFO] Gear database volume already exists. It will NOT be deleted."
else
  echo "[INFO] Gear database volume does not exist yet; Docker Compose will create it."
fi

echo "[1/5] Validating Compose..."
docker compose --env-file "$ENV_FILE" -f compose.yml config >/dev/null

echo "[2/5] Building Dana Apps..."
docker compose --env-file "$ENV_FILE" -f compose.yml build --progress=plain

echo "[3/5] Starting fresh-host stack..."
docker compose --env-file "$ENV_FILE" -f compose.yml up -d

echo "[4/5] Waiting for Gear API readiness..."
for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${GEAR_API_PORT}/api/v1/health/ready" >/dev/null 2>&1; then
    echo "[PASS] Gear API is ready."
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "[FAIL] Gear API did not become ready." >&2
    docker compose --env-file "$ENV_FILE" -f compose.yml ps
    docker compose --env-file "$ENV_FILE" -f compose.yml logs --tail=160 dana-postgres gear-db-bootstrap gear-base-data-bootstrap gear-app-server
    exit 1
  fi
  sleep 5
done

echo "[5/5] Final service state"
docker compose --env-file "$ENV_FILE" -f compose.yml ps

echo
echo "[PASS] Dana Apps fresh Docker host is up."
echo "Blade Tracking: http://<host>:${GEAR_BLADE_UI_PORT}"
echo "Cutter Builder: http://<host>:${GEAR_CUTTER_UI_PORT}"
echo "Greenshed:      http://<host>:${GEAR_GREENSHED_UI_PORT}"
echo "Gear API:       http://<host>:${GEAR_API_PORT}/api/v1/health/ready"
echo
echo "Fresh seed accounts:"
echo "  admin@example.com  (password = SEED_ADMIN_PASSWORD from .env)"
echo "  user@example.com   (password = SEED_USER_PASSWORD from .env)"
