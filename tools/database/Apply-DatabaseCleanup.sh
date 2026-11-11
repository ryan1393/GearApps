#!/usr/bin/env bash
set -euo pipefail
umask 077
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pg_container="${1:?Usage: bash Apply-DatabaseCleanup.sh POSTGRES_CONTAINER [DATABASE] [DATABASE_USER]}"
database="${2:-MeshForge}"
database_user="${3:-}"
[[ "$pg_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid Docker container name.' >&2; exit 1; }
if [[ -z "$database_user" ]]; then database_user="$(docker exec "$pg_container" printenv POSTGRES_USER 2>/dev/null || true)"; fi
database_user="${database_user:-postgres}"
cd -- "$task_root"
[[ ! -f SHA256SUMS.txt ]] || sha256sum -c SHA256SUMS.txt
[[ -f cleanup.sql && -f validate.sql && -f legacy-import.sql ]] || { echo 'Extract the complete cleanup package first.' >&2; exit 1; }
connection=(exec --env "PGDATABASE=$database" --env "PGUSER=$database_user" "$pg_container")
probe="$(docker "${connection[@]}" psql -X -At --set ON_ERROR_STOP=1 --command "SELECT (to_regclass('public.users') IS NOT NULL AND to_regclass('public.gearsets') IS NOT NULL AND to_regclass('public.parts') IS NOT NULL)::text")"
[[ "$probe" == true ]] || { echo 'This is not the expected MeshForge database.' >&2; exit 1; }
operation_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
remote_backup="/tmp/meshforge-before-cleanup-$operation_id.dump"
remote_directory="/tmp/meshforge-cleanup-$operation_id"
remote_sql="$remote_directory/cleanup.sql"
remote_validation="$remote_directory/validate.sql"
remote_legacy="$remote_directory/legacy-import.sql"
mkdir -p -- backups
backup_file="$task_root/backups/MeshForge-before-cleanup-$operation_id.dump"
cleanup_temporary_files(){
  docker exec "$pg_container" rm -f "$remote_backup" "$remote_sql" "$remote_validation" "$remote_legacy" >/dev/null 2>&1 || true
  docker exec "$pg_container" rmdir "$remote_directory" >/dev/null 2>&1 || true
}
trap cleanup_temporary_files EXIT
docker "${connection[@]}" pg_dump --format=custom --no-owner --file "$remote_backup"
docker "${connection[@]}" pg_restore --list "$remote_backup" >/dev/null
docker cp "$pg_container:$remote_backup" "$backup_file"
[[ "$(wc -c < "$backup_file")" -ge 512 ]] || { echo 'Backup is too small; cleanup was not started.' >&2; exit 1; }
sha256sum "$backup_file" > "$backup_file.sha256"
printf 'Verified pre-cleanup backup: %s\n' "$backup_file"
docker exec "$pg_container" mkdir -m 700 "$remote_directory"
docker cp cleanup.sql "$pg_container:$remote_sql"
docker cp legacy-import.sql "$pg_container:$remote_legacy"
docker cp validate.sql "$pg_container:$remote_validation"
docker "${connection[@]}" psql -X --set ON_ERROR_STOP=1 --file "$remote_sql"
docker "${connection[@]}" psql -X --set ON_ERROR_STOP=1 --file "$remote_validation"
echo 'Cleanup committed and structural verification passed. Review the flagged master-data conflicts separately.'
