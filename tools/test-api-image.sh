#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?Usage: bash tools/test-api-image.sh API_IMAGE}"
TASK="gearapps-image-test-$$-$(date +%s)"
WORK_DIR="$(mktemp -d /tmp/gearapps-image-test.XXXXXX)"
CONTAINERS=()
NETWORK_CREATED=false
cleanup() {
  for container in "${CONTAINERS[@]}"; do docker rm -f -v "$container" >/dev/null 2>&1 || true; done
  if [[ "$NETWORK_CREATED" == true ]]; then docker network rm "$TASK" >/dev/null 2>&1 || true; fi
  case "$WORK_DIR" in /tmp/gearapps-image-test.*) rm -rf -- "$WORK_DIR" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077
PASSWORD="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
cat > "$WORK_DIR/postgres.env" <<EOF
POSTGRES_USER=api_test
POSTGRES_PASSWORD=$PASSWORD
POSTGRES_DB=GearApps_image_test
EOF
cat > "$WORK_DIR/api.env" <<EOF
DATABASE_TYPE=postgres
DATABASE_HOST=$TASK-postgres
DATABASE_PORT=5432
DATABASE_USERNAME=api_test
DATABASE_PASSWORD=$PASSWORD
DATABASE_NAME=GearApps_image_test
DATABASE_SYNCHRONIZE=false
DATABASE_LOGGING_ENABLED=false
ENVIRONMENT=test
NODE_ENV=test
SERVER_PORT=3333
EMAIL_ENABLED=false
SOCIAL_GOOGLE_ENABLED=false
ENABLE_SWAGGER=false
JWT_ACCESS_SECRET=access-$PASSWORD
JWT_REFRESH_SECRET=refresh-$PASSWORD
SEED_ADMIN_PASSWORD=admin-$PASSWORD
SEED_USER_PASSWORD=user-$PASSWORD
DANA_FRESH_DB_BOOTSTRAP=YES
EOF

# Load and exercise compiled native bindings in the final, slim runtime image.
docker run --rm "$IMAGE" node -e "const assert=require('node:assert/strict');const Database=require('better-sqlite3');const db=new Database(':memory:');assert.equal(db.prepare('SELECT 1 AS value').get().value,1);db.close();const bcrypt=require('bcrypt');assert.ok(bcrypt.compareSync('ci-test',bcrypt.hashSync('ci-test',4)));require('pg');console.log('Native runtime dependencies verified');"
docker run --rm --entrypoint sh "$IMAGE" -c 'if command -v python3 || command -v g++ || command -v make; then exit 1; fi'

# Synthetic data only; no host ports, existing volumes, or private backups.
docker network create --label codex.task=gearapps-image-test "$TASK" >/dev/null
NETWORK_CREATED=true
docker run -d --name "$TASK-postgres" --label codex.task=gearapps-image-test \
  --network "$TASK" --env-file "$WORK_DIR/postgres.env" \
  --tmpfs /var/lib/postgresql/data postgres:16-alpine >/dev/null
CONTAINERS+=("$TASK-postgres")
ready=false
for attempt in {1..60}; do
  if docker exec "$TASK-postgres" pg_isready -U api_test -d GearApps_image_test >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$TASK-postgres"; exit 1; fi

docker run --rm --network "$TASK" --env-file "$WORK_DIR/api.env" "$IMAGE" node dist/apps/server-bootstrap/main.js
docker run --rm --network "$TASK" --env-file "$WORK_DIR/api.env" "$IMAGE" node tools/manufacturing/base-data/import-base-data.mjs --bootstrap-only
docker run -d --name "$TASK-api" --label codex.task=gearapps-image-test \
  --network "$TASK" --env-file "$WORK_DIR/api.env" "$IMAGE" >/dev/null
CONTAINERS+=("$TASK-api")
ready=false
for attempt in {1..60}; do
  if docker exec "$TASK-api" node -e "fetch('http://127.0.0.1:3333/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=true; break; fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$TASK-api")" != true ]]; then break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$TASK-api"; exit 1; fi
echo 'PASS: final API image, native bindings, fresh PostgreSQL/bootstrap/import and readiness.'
