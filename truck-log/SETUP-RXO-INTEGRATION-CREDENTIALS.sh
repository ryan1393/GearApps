#!/usr/bin/env sh
set -eu

fail() { printf '\nFAIL: %s\n' "$1" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail 'docker was not found.'

docker info >/dev/null 2>&1 || fail 'Could not reach the selected Docker engine.'
for volume in truck-log-rxo-data truck-log-rxo-state truck-log-rxo-credentials; do
  docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
  printf '[PASS] Volume: %s\n' "$volume"
done

printf '\nRXO username: '
IFS= read -r RXO_USERNAME
[ -n "$RXO_USERNAME" ] || fail 'RXO username cannot be blank.'
case "$RXO_USERNAME" in *"$(printf '\r')"*|*"$(printf '\n')"*) fail 'RXO username must be a single line.';; esac

printf 'RXO password: '
old_stty=$(stty -g 2>/dev/null || true)
trap 'if [ -n "${old_stty:-}" ]; then stty "$old_stty" 2>/dev/null || true; fi' EXIT HUP INT TERM
if [ -n "$old_stty" ]; then stty -echo; fi
IFS= read -r RXO_PASSWORD
if [ -n "$old_stty" ]; then stty "$old_stty"; fi
printf '\n'
[ -n "$RXO_PASSWORD" ] || fail 'RXO password cannot be blank.'

printf '%s' "$RXO_USERNAME" | docker run --rm -i \
  -v truck-log-rxo-credentials:/secrets alpine:3.20 \
  sh -c "umask 077; tr -d '\\r\\n' > /secrets/rxo_username; test -s /secrets/rxo_username; chmod 600 /secrets/rxo_username"

printf '%s' "$RXO_PASSWORD" | docker run --rm -i \
  -v truck-log-rxo-credentials:/secrets alpine:3.20 \
  sh -c "umask 077; tr -d '\\r\\n' > /secrets/rxo_password; test -s /secrets/rxo_password; chmod 600 /secrets/rxo_password"

RXO_PASSWORD=''
unset RXO_PASSWORD

docker run --rm -v truck-log-rxo-credentials:/secrets:ro alpine:3.20 \
  sh -c 'test -s /secrets/rxo_username && test -s /secrets/rxo_password' \
  || fail 'Credential verification failed.'

printf '\n[PASS] Standard RXO credentials are configured in the Docker credential volume.\n'
