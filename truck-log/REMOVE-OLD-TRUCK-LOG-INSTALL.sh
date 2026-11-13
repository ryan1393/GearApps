#!/usr/bin/env sh
# Removes containers and volumes left by an older Truck Log install (asks you to type REMOVE first).
#   ./REMOVE-OLD-TRUCK-LOG-INSTALL.sh         only another install's containers and volumes
#   ./REMOVE-OLD-TRUCK-LOG-INSTALL.sh --all   every Truck Log container and volume (test hosts only)
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
. "$ROOT/tools/truck-log/compose-common.sh"
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'FAIL: docker was not found.' >&2; exit 1; }

ALL=false
case "${1:-}" in
  '') ;;
  --all) ALL=true ;;
  *) printf '%s\n' 'Usage: ./REMOVE-OLD-TRUCK-LOG-INSTALL.sh [--all]' >&2; exit 2 ;;
esac

if $ALL; then
  targets=$(
    for name in $TRUCK_LOG_CONTAINER_NAMES; do docker container inspect "$name" >/dev/null 2>&1 && printf 'container %s any\n' "$name"; done
    for name in $TRUCK_LOG_VOLUME_NAMES; do docker volume inspect "$name" >/dev/null 2>&1 && printf 'volume %s any\n' "$name"; done
    true
  )
else
  targets=$(truck_log_foreign_resources)
fi

if [ -z "$targets" ]; then
  printf '%s\n' '[PASS] Nothing to remove.'
  $ALL || printf '%s\n' "To remove Truck Log's own data as well (test hosts only): ./REMOVE-OLD-TRUCK-LOG-INSTALL.sh --all"
  exit 0
fi

printf '\n%s\n' 'These will be removed:'
printf '%s\n' "$targets" | while read -r kind name project; do printf '  %-9s %-36s (project %s)\n' "$kind" "$name" "$project"; done
printf '\n%s\n' 'Removing a volume permanently deletes the data in it: visits, documents, RXO data and logins.'
printf '%s' 'Type REMOVE to continue: '
read -r answer
[ "$answer" = REMOVE ] || { printf '%s\n' 'Cancelled. Nothing was removed.'; exit 1; }

printf '%s\n' "$targets" | while read -r kind name project; do
  [ "$kind" = container ] || continue
  docker rm -f "$name" >/dev/null
  printf '[PASS] Removed container %s\n' "$name"
done
printf '%s\n' "$targets" | while read -r kind name project; do
  [ "$kind" = volume ] || continue
  docker volume rm "$name" >/dev/null || { printf 'FAIL: could not remove volume %s. A container may still be using it: docker ps -a\n' "$name" >&2; exit 1; }
  printf '[PASS] Removed volume %s\n' "$name"
done

if [ -f .env ] && printf '%s\n' "$targets" | grep -q '^volume truck-log-postgres-data '; then
  # The database password in .env belonged to the removed database. Setup makes a new one.
  rm -f .env
  printf '%s\n' '[PASS] Removed .env; setup will create a new one.'
fi
printf '\n%s\n' 'Done. Next: ./SETUP-TRUCK-LOG.sh'
