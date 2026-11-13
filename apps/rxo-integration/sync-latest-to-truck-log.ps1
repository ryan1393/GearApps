$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
. "$PSScriptRoot\remote-docker.ps1"

$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# In a Docker install the Truck Log server copies and imports each verified RXO export
# itself (checked every 30 seconds). This workstation copy is for local development only.
$EnvFile = Join-Path $WorkspaceRoot ".env"
if ((Test-Path -LiteralPath $EnvFile) -and (Select-String -LiteralPath $EnvFile -Pattern '^TRUCK_LOG_DATABASE_HOST=truck-log-postgres\s*$' -Quiet)) {
    Write-Host ""
    Write-Host "Nothing to do here: this is a Docker install." -ForegroundColor Green
    Write-Host "The Truck Log server imports each new RXO export automatically within about a minute."
    Write-Host "To import right away, open RXO Control Center in Truck Log (signed in as administrator) and select Sync latest."
    exit 0
}
$RxoDataRoot = Join-Path $WorkspaceRoot "data\rxo"
$Final = Join-Path $RxoDataRoot "latest"
$Previous = Join-Path $RxoDataRoot "previous"
$Staging = Join-Path $RxoDataRoot (".incoming-" + [Guid]::NewGuid().ToString("N"))
$TempName = "truck-log-rxo-sync-" + [Guid]::NewGuid().ToString("N")

New-Item -ItemType Directory -Force -Path $RxoDataRoot | Out-Null
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

Require-RemoteDocker

Write-Host ""
Write-Host "Copying the verified RXO latest snapshot into Truck Log..."
Write-Host "Remote source: Docker volume truck-log-rxo-data:/data/latest"
Write-Host "Local staging: $Staging"
Write-Host ""

try {
    $Created = Invoke-NativeRetry `
        -Description "Create temporary RXO copy container" `
        -MaxAttempts 4 `
        -InitialDelaySeconds 4 `
        -Command {
            & docker create `
                --name $TempName `
                -v truck-log-rxo-data:/data:ro `
                alpine:3.20 `
                sh -c "sleep 300" | Out-Null
        }

    if (-not $Created) {
        throw "Could not create the temporary RXO copy container."
    }

    $Copied = Invoke-NativeRetry `
        -Description "Copy RXO latest snapshot to Truck Log staging" `
        -MaxAttempts 4 `
        -InitialDelaySeconds 5 `
        -Command {
            if (Test-Path -LiteralPath $Staging) {
                Remove-Item -LiteralPath $Staging -Recurse -Force
            }
            New-Item -ItemType Directory -Force -Path $Staging | Out-Null

            & docker cp `
                "${TempName}:/data/latest/." `
                "$Staging"
        }

    if (-not $Copied) {
        throw "Could not copy RXO latest snapshot from the Docker volume."
    }
}
finally {
    & { $ErrorActionPreference = 'Continue'; & docker rm -f $TempName *> $null }
}

Write-Host ""
Write-Host "Validating six-file Truck Log ingestion boundary..."

& node `
    (Join-Path $WorkspaceRoot "tools\truck-log\rxo\verify-local-rxo-latest.mjs") `
    $Staging

if ($LASTEXITCODE -ne 0) {
    throw "Copied RXO snapshot failed the local Truck Log boundary contract. Existing data\rxo\latest was left unchanged."
}

if (Test-Path -LiteralPath $Previous) {
    Remove-Item -LiteralPath $Previous -Recurse -Force
}

if (Test-Path -LiteralPath $Final) {
    Move-Item -LiteralPath $Final -Destination $Previous
}

Move-Item -LiteralPath $Staging -Destination $Final

Write-Host ""
Write-Host "============================================================"
Write-Host " RXO LATEST SNAPSHOT PUBLISHED TO TRUCK LOG"
Write-Host "============================================================"
Write-Host ""
Write-Host "Current:  $Final"
if (Test-Path -LiteralPath $Previous) {
    Write-Host "Previous: $Previous"
}
Write-Host ""
Write-Host "The verified source snapshot is now local. PostgreSQL import follows when enabled."

$ImportAfterSync = if ($env:TRUCK_LOG_RXO_IMPORT_AFTER_SYNC) {
    $env:TRUCK_LOG_RXO_IMPORT_AFTER_SYNC -notmatch '^(0|false|no)$'
} else {
    $true
}

if ($ImportAfterSync) {
    Write-Host ""
    Write-Host "Importing verified RXO snapshot into Truck Log PostgreSQL..."
    & (Join-Path $WorkspaceRoot "tools\truck-log\rxo\import-latest.ps1")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "The verified snapshot remains available at $Final." -ForegroundColor Yellow
        Write-Host "After the Truck Log API is ready, retry with IMPORT-RXO-LATEST.cmd." -ForegroundColor Yellow
        throw "RXO source snapshot was published locally, but PostgreSQL import failed."
    }
} else {
    Write-Host ""
    Write-Host "PostgreSQL import skipped because TRUCK_LOG_RXO_IMPORT_AFTER_SYNC is disabled."
}
