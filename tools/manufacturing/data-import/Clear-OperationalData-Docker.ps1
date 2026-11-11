[CmdletBinding()]
param(
    # The MeshForge PostgreSQL container. Found automatically when one running container has "postgres" in its name.
    [string]$PgContainer = '',
    # Defaults to POSTGRES_DB / POSTGRES_USER inside the container.
    [string]$Database = '',
    [string]$DatabaseUser = '',
    # Without -Apply this only lists what would be emptied and kept.
    [switch]$Apply
)
# Clears operational data in a MeshForge database that runs in Docker, keeping users and base data.
# Needs only Docker: psql and pg_dump run inside the PostgreSQL container. The SQL is
# clear-operational-data.sql, generated from the same lists as clear-operational-data.mjs.
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$SqlPath = Join-Path $PSScriptRoot 'clear-operational-data.sql'
if (-not (Test-Path -LiteralPath $SqlPath -PathType Leaf)) { throw "Missing file: $SqlPath" }

function Invoke-Docker([string[]]$DockerArguments, [string]$Failure) {
    $result = @(& docker @DockerArguments)
    if ($LASTEXITCODE -ne 0) { throw $Failure }
    return $result
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is not installed or not on PATH on this computer.' }

if ([string]::IsNullOrWhiteSpace($PgContainer)) {
    $candidates = @(Invoke-Docker @('ps', '--filter', 'name=postgres', '--format', '{{.Names}}') 'Could not list Docker containers. Is Docker running?')
    if ($candidates.Count -ne 1) {
        Write-Host 'Running containers:' -ForegroundColor Yellow
        & docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
        if ($candidates.Count -eq 0) { throw 'No running container has "postgres" in its name. Pass the MeshForge database container with -PgContainer NAME.' }
        throw "More than one PostgreSQL container is running ($($candidates -join ', ')). Pass the MeshForge one with -PgContainer NAME."
    }
    $PgContainer = $candidates[0]
}
if ($PgContainer -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') { throw 'Use a Docker container name or ID.' }

if ([string]::IsNullOrWhiteSpace($DatabaseUser)) {
    $users = @(& docker exec $PgContainer printenv POSTGRES_USER)
    if ($LASTEXITCODE -eq 0 -and $users.Count -eq 1) { $DatabaseUser = $users[0] } else { $DatabaseUser = 'postgres' }
}
if ([string]::IsNullOrWhiteSpace($Database)) {
    $names = @(& docker exec $PgContainer printenv POSTGRES_DB)
    if ($LASTEXITCODE -eq 0 -and $names.Count -eq 1) { $Database = $names[0] } else { $Database = 'MeshForge' }
}

Write-Host "Container : $PgContainer"
Write-Host "Database  : $Database (user $DatabaseUser)"
$connection = @('exec', '--env', "PGDATABASE=$Database", '--env', "PGUSER=$DatabaseUser", $PgContainer)
$operationId = [Guid]::NewGuid().ToString('N')
$containerSql = "/tmp/meshforge-clear-$operationId.sql"
$containerBackup = "/tmp/meshforge-before-clear-$operationId.dump"

try {
    Invoke-Docker @('cp', $SqlPath, "${PgContainer}:$containerSql") 'Could not copy the clear script into the container.' | Out-Null

    # Preview: lists every table with its row count, then rolls back.
    $previewArguments = $connection + @('psql', '-X', '--set', 'ON_ERROR_STOP=1', '--file', $containerSql)
    & docker @previewArguments
    if ($LASTEXITCODE -ne 0) { throw 'Preview failed. Nothing was deleted.' }
    if (-not $Apply) { return }

    Write-Host ''
    Write-Host 'Close or stop the MeshForge API before continuing.' -ForegroundColor Yellow
    $confirm = Read-Host 'Type CLEAR DATA to continue'
    if ($confirm -ne 'CLEAR DATA') { Write-Host 'Cancelled. Nothing was deleted.'; return }

    # Backup first, in the container, then copied out. Nothing is cleared unless this succeeds.
    $backupDirectory = Join-Path $ProjectRoot 'tools\manufacturing\data-import\work\backups'
    [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $backupFile = Join-Path $backupDirectory "$Database-before-clear-$stamp.dump"
    Invoke-Docker ($connection + @('pg_dump', '--format=custom', '--no-owner', '--file', $containerBackup)) 'Backup failed. Nothing was deleted.' | Out-Null
    Invoke-Docker @('cp', "${PgContainer}:$containerBackup", $backupFile) 'Could not copy the backup out of the container. Nothing was deleted.' | Out-Null
    if ((Get-Item -LiteralPath $backupFile).Length -lt 512) { throw 'The backup is unexpectedly small. Nothing was deleted.' }
    Write-Host "[PASS] Backup: $backupFile" -ForegroundColor Green
    Write-Host "       Restore with: docker cp `"$backupFile`" ${PgContainer}:/tmp/restore.dump, then pg_restore --clean -d $Database /tmp/restore.dump inside the container."

    $applyArguments = $connection + @('psql', '-X', '--set', 'ON_ERROR_STOP=1', '--set', 'apply=true', '--file', $containerSql)
    & docker @applyArguments
    if ($LASTEXITCODE -ne 0) { throw 'Clear failed and was rolled back. Nothing was deleted. If it says lock timeout, stop the MeshForge API container and try again.' }
    Write-Host 'Next: start MeshForge and make shelves in Admin > Locations > Bulk shelf locations.' -ForegroundColor Cyan
}
finally {
    & docker exec $PgContainer rm -f $containerSql $containerBackup | Out-Null
}
