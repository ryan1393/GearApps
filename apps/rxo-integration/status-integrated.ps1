$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
. "$PSScriptRoot\remote-docker.ps1"

Write-Host ""
Write-Host "============================================================"
Write-Host " TRUCK LOG / RXO INTEGRATION STATUS"
Write-Host "============================================================"
Write-Host ""

Require-RemoteDocker

Write-Host "Compose service:"
Write-Host ""

Invoke-RxoCompose -CommandArgs @('ps', 'rxo-export') |
    ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "Remote health + latest manifest:"
Write-Host ""

$StatusOk = Invoke-NativeRetry `
    -Description "Read RXO health and latest manifest" `
    -MaxAttempts 4 `
    -InitialDelaySeconds 4 `
    -Command {
        & docker run --rm `
            -v truck-log-rxo-data:/data:ro `
            alpine:3.20 `
            sh -c "echo '--- health.json ---'; if [ -f /data/health.json ]; then cat /data/health.json; else echo 'No health.json yet.'; fi; echo; echo '--- latest/fort-wayne/manifest.json ---'; if [ -f /data/latest/fort-wayne/manifest.json ]; then cat /data/latest/fort-wayne/manifest.json; else echo 'No completed Fort Wayne manifest yet.'; fi"
    }

if (-not $StatusOk) {
    throw "Could not read RXO status after remote-Docker retries."
}

$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LocalBoundary = Join-Path $WorkspaceRoot "data\rxo\latest\truck-log-ingestion-boundary.json"

Write-Host ""
Write-Host "Local Truck Log ingestion boundary:"
if (Test-Path -LiteralPath $LocalBoundary) {
    Write-Host "  $LocalBoundary" -ForegroundColor Green
    Get-Content -LiteralPath $LocalBoundary
}
else {
    Write-Host "  Not synchronized yet. Run SYNC-RXO-LATEST-TO-TRUCK-LOG.cmd." -ForegroundColor Yellow
}
