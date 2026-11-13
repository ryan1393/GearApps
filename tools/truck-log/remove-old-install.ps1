[CmdletBinding()]
param(
    # Also remove Truck Log's own containers and volumes, not just another install's.
    # Use only when this host has never held real Truck Log data.
    [switch]$All
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker.exe was not found.' }
. (Join-Path $PSScriptRoot 'compose-common.ps1')

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host '  Truck Log - Remove an old install' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor DarkCyan
$context = (& docker context show).Trim()
Write-Host "Docker context: $context"

$targets = New-Object System.Collections.Generic.List[object]
if ($All) {
    foreach ($name in $script:TruckLogContainerNames) {
        & { $ErrorActionPreference = 'Continue'; & docker container inspect $name *> $null }
        if ($LASTEXITCODE -eq 0) { $targets.Add([pscustomobject]@{ Kind = 'container'; Name = $name; Project = 'any' }) }
    }
    foreach ($name in $script:TruckLogVolumeNames) {
        & { $ErrorActionPreference = 'Continue'; & docker volume inspect $name *> $null }
        if ($LASTEXITCODE -eq 0) { $targets.Add([pscustomobject]@{ Kind = 'volume'; Name = $name; Project = 'any' }) }
    }
} else {
    foreach ($item in (Get-ForeignTruckLogResources)) { $targets.Add($item) }
}

if ($targets.Count -eq 0) {
    Write-Host ''
    Write-Host '[PASS] Nothing to remove.' -ForegroundColor Green
    if (-not $All) { Write-Host 'To remove Truck Log''s own data as well (test hosts only): REMOVE-OLD-TRUCK-LOG-INSTALL.cmd -All' }
    exit 0
}

Write-Host ''
Write-Host 'These will be removed:' -ForegroundColor Yellow
foreach ($item in $targets) { Write-Host ("  {0,-9} {1,-36} (project {2})" -f $item.Kind, $item.Name, $item.Project) }
Write-Host ''
Write-Host 'Removing a volume permanently deletes the data in it: visits, documents, RXO data and logins.' -ForegroundColor Yellow
$answer = Read-Host 'Type REMOVE to continue'
if ($answer -cne 'REMOVE') {
    Write-Host 'Cancelled. Nothing was removed.'
    exit 1
}

foreach ($item in $targets | Where-Object { $_.Kind -eq 'container' }) {
    & docker rm -f $item.Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not remove container $($item.Name)." }
    Write-Host "[PASS] Removed container $($item.Name)" -ForegroundColor Green
}
foreach ($item in $targets | Where-Object { $_.Kind -eq 'volume' }) {
    & docker volume rm $item.Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not remove volume $($item.Name). A container from another install may still be using it: docker ps -a" }
    Write-Host "[PASS] Removed volume $($item.Name)" -ForegroundColor Green
}

if (Test-Path -LiteralPath '.env') {
    $removedDatabase = @($targets | Where-Object { $_.Kind -eq 'volume' -and $_.Name -eq 'truck-log-postgres-data' }).Count -gt 0
    if ($removedDatabase) {
        # The database password in .env belonged to the removed database. Setup makes a new one.
        Remove-Item -LiteralPath '.env' -Force
        Write-Host '[PASS] Removed .env; setup will create a new one.' -ForegroundColor Green
    }
}

if ([Environment]::GetEnvironmentVariable('TRUCK_LOG_RELEASE', 'User')) {
    [Environment]::SetEnvironmentVariable('TRUCK_LOG_RELEASE', $null, 'User')
    Write-Host '[PASS] Removed an old TRUCK_LOG_RELEASE setting from your Windows user environment.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Done. Next: SETUP-TRUCK-LOG.cmd'
