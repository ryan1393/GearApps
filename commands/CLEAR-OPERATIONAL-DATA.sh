#!/usr/bin/env bash
# Clears operational data on the Linux Docker host and keeps users, base data and the
# shelf/layer/bin locations. Linux counterpart of CLEAR-OPERATIONAL-DATA.cmd.
#
# Run on the Docker host, in the release folder that holds compose.yml and .env
# (~/dana-apps after Deploy-MeshForge):
#   bash commands/CLEAR-OPERATIONAL-DATA.sh
#
# 1. Previews what is emptied, deleted and kept (nothing is changed).
# 2. Asks for the exact phrase CLEAR DATA.
# 3. Saves and verifies a full pg_dump backup in ~/dana-apps-backups (outside the release
#    folder, which each deploy replaces). Set MESHFORGE_BACKUP_DIR to use another folder.
# 4. Stops meshforge-server, clears the data in one transaction, starts it again.
#
# The clear itself is tools/manufacturing/data-import/clear-operational-data.mjs, run in a
# one-off container from the meshforge-server image (its Node and pg driver, the database
# settings from compose.yml and .env). The script folder is mounted from this host, so an
# image built before the script existed works too.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROJECT="dana-apps" # compose.yml `name:`; the deploy tool uses the same project
ENV_FILE="$ROOT/.env"
SCRIPT_DIR="tools/manufacturing/data-import"
SCRIPT="$SCRIPT_DIR/clear-operational-data.mjs"
CONFIRM_FLAG="--yes-delete-operational-data"
API_SERVICE="meshforge-server"
DB_SERVICE="dana-postgres"
BACKUP_DIR="${MESHFORGE_BACKUP_DIR:-$HOME/dana-apps-backups}"

fail() { echo "[FAIL] $*" >&2; exit 1; }

[[ -f compose.yml ]] || fail "compose.yml not found in $ROOT."
[[ -f "$ENV_FILE" ]] || fail ".env is missing in $ROOT."
[[ -f "$SCRIPT" ]] || fail "$SCRIPT is missing. Copy the complete Dana Apps folder to this host."
command -v docker >/dev/null 2>&1 || fail "docker is not installed or not on PATH."

if docker compose version >/dev/null 2>&1; then
  compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f compose.yml "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose -p "$PROJECT" --env-file "$ENV_FILE" -f compose.yml "$@"; }
else
  fail "Docker Compose is not installed on this host."
fi

# Running container of a service, found by its compose labels.
container_of() {
  docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -1
}

# One-off container from the API image; does not publish ports or start other services.
# It gets no input, so it cannot swallow the confirmation typed afterwards.
run_clear() {
  compose run --rm --no-deps -T \
    -e MESHFORGE_CLEAR_FROM_LAUNCHER=1 \
    -v "$ROOT/$SCRIPT_DIR:/app/$SCRIPT_DIR" \
    "$API_SERVICE" node "$SCRIPT" "$@" </dev/null
}

echo
echo "============================================================"
echo " MESHFORGE - CLEAR OPERATIONAL DATA (KEEP USERS + BASE DATA)"
echo "============================================================"
echo
echo "This EMPTIES blades, trays, containers, cutter builds, cutter events and"
echo "history, coater shipments and Greenshed counts in the MeshForge database"
echo "of this Docker host. It DELETES every location except the shelf/layer/bin"
echo "bins (CGDR-A1A etc.) and COATER-STAGING."
echo
echo "KEPT: users, departments, models, parts, part summaries, blade"
echo "requirements, cutter body definitions, cutter bodies, roll masters,"
echo "gearsets, machines, settings, label printers, shelf/layer/bin"
echo "locations (now empty) and all Lapper data."
echo

PG="$(container_of "$DB_SERVICE")"
[[ -n "$PG" ]] || fail "$DB_SERVICE is not running. Start it with: docker compose up -d $DB_SERVICE"

echo "[1/4] Preview (nothing is changed)..."
run_clear || fail "Preview failed. Nothing was deleted."

echo
[[ -t 0 ]] || fail "Run this in an interactive terminal: it asks for confirmation. Nothing was deleted."
read -r -p "Type CLEAR DATA to continue: " CONFIRM
if [[ "$CONFIRM" != "CLEAR DATA" ]]; then
  echo "Cancelled. Nothing was deleted."
  exit 1
fi

echo
echo "[2/4] Backing up the database..."
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/MeshForge-before-clear-$STAMP.dump"
REMOTE_BACKUP="/tmp/meshforge-before-clear-$STAMP.dump"
docker exec "$PG" sh -c \
  "pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --format=custom --no-owner --file '$REMOTE_BACKUP' && pg_restore --list '$REMOTE_BACKUP' >/dev/null" \
  || fail "Backup failed. Nothing was deleted."
docker cp "$PG:$REMOTE_BACKUP" "$BACKUP" || fail "Could not copy the backup out of $DB_SERVICE. Nothing was deleted."
docker exec "$PG" rm -f "$REMOTE_BACKUP" >/dev/null 2>&1 || true
chmod 600 "$BACKUP"
[[ "$(wc -c < "$BACKUP")" -ge 512 ]] || fail "Backup $BACKUP is too small. Nothing was deleted."
sha256sum "$BACKUP" > "$BACKUP.sha256"
echo "[PASS] Verified backup: $BACKUP"

API_WAS_RUNNING=false
if [[ -n "$(container_of "$API_SERVICE")" ]]; then API_WAS_RUNNING=true; fi
restart_api() {
  if [[ "$API_WAS_RUNNING" == true ]]; then
    echo
    echo "Starting $API_SERVICE again..."
    compose start "$API_SERVICE" || echo "[WARN] Could not start $API_SERVICE. Run: docker compose start $API_SERVICE" >&2
  fi
}
trap restart_api EXIT

echo
echo "[3/4] Stopping $API_SERVICE..."
if [[ "$API_WAS_RUNNING" == true ]]; then compose stop "$API_SERVICE"; fi

echo
echo "[4/4] Clearing operational data..."
if ! run_clear --apply "$CONFIRM_FLAG"; then
  echo
  echo "[FAIL] Clear failed. Review the error above; the transaction was rolled back." >&2
  exit 1
fi

echo
echo "Operational data cleared."
echo "Row counts from just before the clear: $SCRIPT_DIR/work/pre-clear-operational-data-manifest.json"
echo "Backup: $BACKUP"
echo "Next: make trays and containers in Admin > Launch Setup."
