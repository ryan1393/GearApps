#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
# The image tag Compose builds: TRUCK_LOG_RELEASE from .env, else the VERSION file.
RELEASE=''
if [ -f .env ]; then
  RELEASE=$(sed -n 's/^[[:space:]]*TRUCK_LOG_RELEASE[[:space:]]*=[[:space:]]*//p' .env | tail -n 1 | tr -d '"'"'"'\r[:space:]')
fi
[[ -n "$RELEASE" ]] || RELEASE=$(tr -d '[:space:]' < VERSION)
[[ "$RELEASE" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$ ]] || { echo "TRUCK_LOG_RELEASE is not a valid image tag: $RELEASE" >&2; exit 1; }
IMAGE="truck-log-rxo-expedite:$RELEASE"
VOLUME='truck-log-rxo-credentials'

. "$ROOT/tools/truck-log/compose-common.sh"
truck_log_resolve_compose || { echo 'Docker Compose v2+ is required. Run ./SETUP-TRUCK-LOG.sh first.' >&2; exit 1; }
docker info >/dev/null
docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo '[INFO] RXO Expedite image is not built yet. Building it now...'
  truck_log_compose build rxo-expedite-scheduler
fi
read -r -p 'RXO Expedite username: ' USERNAME
read -r -s -p 'RXO Expedite password: ' PASSWORD
echo
[[ -n "${USERNAME//[[:space:]]/}" ]] || { echo 'Username cannot be blank.' >&2; exit 1; }
[[ -n "$PASSWORD" ]] || { echo 'Password cannot be blank.' >&2; exit 1; }
[[ "$USERNAME" != *$'\n'* && "$USERNAME" != *$'\r'* && "$PASSWORD" != *$'\n'* && "$PASSWORD" != *$'\r'* ]] || { echo 'Credentials must be single-line values.' >&2; exit 1; }
WAS_RUNNING=false
if [[ "$(docker inspect --format '{{.State.Running}}' truck-log-rxo-expedite-scheduler 2>/dev/null || true)" == 'true' ]]; then
  WAS_RUNNING=true
  docker stop truck-log-rxo-expedite-scheduler >/dev/null
fi
restore() {
  PASSWORD=''
  if $WAS_RUNNING; then docker start truck-log-rxo-expedite-scheduler >/dev/null || true; fi
}
trap restore EXIT
printf '%s\n%s' "$USERNAME" "$PASSWORD" \
  | docker run --rm -i --network none --read-only --entrypoint node "$IMAGE" -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const i=s.indexOf("\n");if(i<1)process.exit(2);process.stdout.write(JSON.stringify({username:s.slice(0,i),password:s.slice(i+1)}));});' \
  | docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
      -v "$VOLUME:/run/secrets" "$IMAGE" --set-credentials >/dev/null
echo '[PASS] RXO Expedite credentials stored.'
