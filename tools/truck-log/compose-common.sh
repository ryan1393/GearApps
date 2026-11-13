#!/usr/bin/env sh
# shellcheck shell=sh

truck_log_compose_mode=''
truck_log_compose_version=''

truck_log_compose_major() {
  value=$(printf '%s' "$1" | tr -d '\r\n')
  case "$value" in 'Docker Compose version '*) value=${value#Docker Compose version } ;; esac
  case "$value" in v*) value=${value#v} ;; esac
  major=${value%%.*}
  rest=${value#*.}
  [ "$rest" != "$value" ] || return 0
  case "$major" in ''|*[!0-9]*) return 0 ;; esac
  printf '%s' "$major"
}

truck_log_resolve_compose() {
  version=$(docker compose version --short 2>/dev/null || true)
  major=$(truck_log_compose_major "$version")
  if [ -n "$major" ] && [ "$major" -ge 2 ] 2>/dev/null; then
    truck_log_compose_mode='plugin'
    truck_log_compose_version=$version
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    version=$(docker-compose version --short 2>/dev/null || true)
    major=$(truck_log_compose_major "$version")
    if [ -n "$major" ] && [ "$major" -ge 2 ] 2>/dev/null; then
      truck_log_compose_mode='standalone'
      truck_log_compose_version=$version
      return 0
    fi
  fi
  printf '%s\n' 'FAIL: Docker Compose v2+ was not found. Install the Docker Compose v2 plugin (preferred) or a v2 standalone frontend.' >&2
  return 1
}

truck_log_compose() {
  [ -n "$truck_log_compose_mode" ] || truck_log_resolve_compose
  truck_log_pin_release
  if [ "$truck_log_compose_mode" = 'plugin' ]; then docker compose -p truck-log "$@"
  else docker-compose -p truck-log "$@"
  fi
}

# Fixed names used by docker-compose.yml (test-compose.mjs keeps these lists in sync).
TRUCK_LOG_CONTAINER_NAMES='truck-log-postgres truck-log-server truck-log-web truck-log-rxo-export truck-log-rxo-browser truck-log-rxo-expedite-scheduler'
TRUCK_LOG_VOLUME_NAMES='truck-log-postgres-data truck-log-documents truck-log-rxo-import truck-log-rxo-data truck-log-rxo-state truck-log-rxo-credentials truck-log-rxo-expedite-data truck-log-rxo-expedite-state'

# The image tag always comes from VERSION, so a TRUCK_LOG_RELEASE exported by an older
# install's shell profile cannot override .env and build old tags.
truck_log_pin_release() {
  [ -f VERSION ] || return 0
  TRUCK_LOG_RELEASE=$(tr -d '[:space:]' < VERSION)
  export TRUCK_LOG_RELEASE
}

truck_log_word_in() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }

# Prints "kind name project" for containers and volumes that use Truck Log's fixed names
# but belong to another Compose project (an older install). Unlabelled volumes are normal:
# the credential setup tools create some of them.
truck_log_foreign_resources() {
  docker ps -a --filter name=truck-log --format '{{.Names}} {{.Label "com.docker.compose.project"}}' 2>/dev/null |
  while read -r name project; do
    truck_log_word_in "$name" "$TRUCK_LOG_CONTAINER_NAMES" || continue
    [ "$project" = truck-log ] || printf 'container %s %s\n' "$name" "${project:-none}"
  done
  docker volume ls --filter name=truck-log --format '{{.Name}} {{.Label "com.docker.compose.project"}}' 2>/dev/null |
  while read -r name project; do
    truck_log_word_in "$name" "$TRUCK_LOG_VOLUME_NAMES" || continue
    [ -z "$project" ] || [ "$project" = truck-log ] || printf 'volume %s %s\n' "$name" "$project"
  done
}

truck_log_assert_no_foreign_resources() {
  found=$(truck_log_foreign_resources)
  [ -n "$found" ] || return 0
  printf '\n%s\n' '[STOP] An older Truck Log install is still on this Docker host:' >&2
  printf '%s\n' "$found" | while read -r kind name project; do printf '  %-9s %-36s (project %s)\n' "$kind" "$name" "$project" >&2; done
  printf '%s\n' 'These use the same names as Truck Log, so it cannot start next to them.' \
    'If that install holds only test data, run ./REMOVE-OLD-TRUCK-LOG-INSTALL.sh, then run this again.' \
    'If you need its data, stop here and contact the Truck Log maintainer.' >&2
  return 1
}
