[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'compose-common.ps1')

# The image tag Compose builds: TRUCK_LOG_RELEASE from .env, else the VERSION file.
function Get-TruckLogRelease {
    $EnvPath = Join-Path $Root '.env'
    if (Test-Path -LiteralPath $EnvPath) {
        $Match = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match '^\s*TRUCK_LOG_RELEASE\s*=' } | Select-Object -Last 1
        if ($Match) {
            $Value = ($Match -split '=', 2)[1].Trim().Trim('"').Trim("'")
            if ($Value) { return $Value }
        }
    }
    return (Get-Content -LiteralPath (Join-Path $Root 'VERSION') -Raw).Trim()
}
$Release = Get-TruckLogRelease
if ($Release -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$') { throw "TRUCK_LOG_RELEASE is not a valid image tag: $Release" }
$ExpediteImage = "truck-log-rxo-expedite:$Release"

function Ensure-Volume([string]$Name) {
    $existing = @(& docker volume ls --format '{{.Name}}')
    if ($LASTEXITCODE -ne 0) { throw 'Could not list Docker volumes.' }
    if ($existing -notcontains $Name) {
        & docker volume create $Name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not create Docker volume $Name." }
    }
}

function Ensure-ExpediteImage {
    & { $ErrorActionPreference = 'Continue'; & docker image inspect $ExpediteImage *> $null }
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host '[INFO] RXO Expedite image is not built yet. Building it now...' -ForegroundColor Yellow
    Resolve-TruckLogCompose
    Invoke-TruckLogCompose -CommandArgs @('build','rxo-expedite-scheduler') | Out-Null
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'docker.exe was not found.'
}
& { $ErrorActionPreference = 'Continue'; & docker info *> $null }
if ($LASTEXITCODE -ne 0) { throw 'The selected Docker engine is not reachable.' }

Ensure-Volume 'truck-log-rxo-credentials'
Ensure-ExpediteImage

$Username = (Read-Host 'RXO Expedite username').Trim()
$SecurePassword = Read-Host 'RXO Expedite password' -AsSecureString
if (-not $Username) { throw 'RXO Expedite username cannot be blank.' }

$Ptr = [IntPtr]::Zero
$PlainPassword = $null
$WasRunning = $false
try {
    $Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
    $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr)
    if ([string]::IsNullOrWhiteSpace($PlainPassword)) { throw 'RXO Expedite password cannot be blank.' }
    if ($Username -match "[\r\n]" -or $PlainPassword -match "[\r\n]") { throw 'Credentials must be single-line values.' }

    $running = ([string](& { $ErrorActionPreference = 'Continue'; & docker inspect --format '{{.State.Running}}' truck-log-rxo-expedite-scheduler 2>$null })).Trim()
    $WasRunning = ($LASTEXITCODE -eq 0 -and $running -eq 'true')
    if ($WasRunning) {
        Write-Host '[INFO] Pausing the Expedite scheduler while the credential pointer is updated.'
        & docker stop truck-log-rxo-expedite-scheduler | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not pause the RXO Expedite scheduler.' }
    }

    $Payload = @{ username = $Username; password = $PlainPassword } | ConvertTo-Json -Compress
    $Payload | & docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges `
        -v 'truck-log-rxo-credentials:/run/secrets' `
        $ExpediteImage --set-credentials | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'RXO Expedite credential update failed.' }

    Write-Host '[PASS] RXO Expedite credentials were stored in the shared Docker credential volume.' -ForegroundColor Green
}
finally {
    if ($Ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr) }
    $PlainPassword = $null
    $SecurePassword = $null
    if ($WasRunning) {
        & docker start truck-log-rxo-expedite-scheduler | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Credentials were updated, but the Expedite scheduler could not be restarted automatically.' }
        else { Write-Host '[PASS] RXO Expedite scheduler restarted.' -ForegroundColor Green }
    }
}
