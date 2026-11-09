#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
command -v docker >/dev/null 2>&1 || { echo 'FAIL: Docker CLI missing.' >&2; exit 1; }
. "$ROOT/tools/truck-log/compose-common.sh"
truck_log_resolve_compose || exit 1
printf '%s\n' 'Truck Log RXO web setup verification (read-only; no secrets or live exports).'

# This evaluates only local API status and database metadata. API responses are
# whitelisted to booleans; passwords, tokens, and configured usernames are omitted.
truck_log_compose exec -T truck-log-server node -e '
(async () => {
  const root="http://127.0.0.1:3334/api/v1/";
  async function get(path) {
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),25000);
    try { const r=await fetch(root+path,{signal:controller.signal});
      if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    finally { clearTimeout(timer); }
  }
  try {
    const admin=await get("admin-auth/status");
    console.log("Admin transport configured:", admin.enabled===true && admin.configured===true ? "YES" : "NO");
    const standard=await get("rxo/control");
    console.log("Standard RXO credentials:", standard?.credentials?.usernameConfigured===true && standard?.credentials?.passwordConfigured===true ? "CONFIGURED" : "MISSING");
    const expedite=await get("rxo/expedite");
    console.log("Expedite web credential writes:", expedite.credentialUpdatesEnabled===true ? "ENABLED" : "DISABLED");
    console.log("Expedite credentials:", expedite?.credentials?.configured===true ? "CONFIGURED" : "MISSING");
  } catch(e) { console.error("FAIL: API status unavailable or invalid:",e.message); process.exitCode=1; }
})();'

# The admin schema is intentionally not part of database migrations 001-010.
# Check metadata without showing any credentials, usernames, or password hashes.
SCHEMA=$(truck_log_compose exec -T truck-log-postgres \
  sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2>/dev/null <<'SQL'
SELECT CASE WHEN to_regclass('truck_log_admin.users') IS NOT NULL THEN 'SCHEMA_PRESENT' ELSE 'SCHEMA_MISSING' END;
SQL
) || { echo 'FAIL: could not read administrator schema state.' >&2; exit 1; }
printf 'Administrator schema: %s\n' "$SCHEMA"
if [ "$SCHEMA" = SCHEMA_PRESENT ]; then
  STATUS=$(truck_log_compose exec -T truck-log-postgres \
    sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2>/dev/null <<'SQL'
SELECT CASE WHEN count(*) > 0 THEN 'ACCOUNT_READY' ELSE 'NO_ADMIN_USERS' END FROM truck_log_admin.users;
SQL
  ) || { echo 'FAIL: could not verify administrator account state.' >&2; exit 1; }
  printf 'Administrator account: %s\n' "$STATUS"
else
  printf '%s\n' 'Administrator account: NOT_READY (first run --migrate and --bootstrap)'
fi
