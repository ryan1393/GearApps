$ErrorActionPreference = "Continue"

Set-Location $PSScriptRoot
. "$PSScriptRoot\remote-docker.ps1"

Write-Host ""
Write-Host "RXO Export Status"
Write-Host "-----------------------"
Write-Host ""

Invoke-RxoCompose -CommandArgs @('ps', 'rxo-export') | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "Health:"
Write-Host ""

& docker run --rm `
    -v truck-log-rxo-data:/data:ro `
    alpine:3.20 `
    sh -c "if [ -f /data/health.json ]; then cat /data/health.json; else echo 'No health.json yet.'; fi"

Write-Host ""
Write-Host "Latest files:"
Write-Host ""

& docker run --rm `
    -v truck-log-rxo-data:/data:ro `
    alpine:3.20 `
    sh -c "if [ -d /data/latest ]; then find /data/latest -maxdepth 4 -type f -printf '%p  %s bytes\n'; else echo 'No latest files yet.'; fi"
