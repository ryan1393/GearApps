#!/bin/sh
set -eu

echo '[truck-log] Applying database migrations...'
node ./tools/truck-log/migrate.mjs

ENTRY="$(find ./dist/apps/truck-log-server -type f -name main.js | head -n 1)"
if [ -z "$ENTRY" ]; then
  echo '[truck-log] ERROR: compiled API entrypoint main.js was not found.' >&2
  exit 1
fi

echo '[truck-log] Starting API...'
exec node "$ENTRY"
