[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$NoReset,
    [switch]$ValidateData,
    [int]$ServerWaitSeconds = 90
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WorkspaceRoot = $ProjectRoot
Set-Location $WorkspaceRoot

Write-Host ''
Write-Host 'Unblocking downloaded MeshForge files...' -ForegroundColor Yellow
try {
    Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -ErrorAction Stop |
        Unblock-File -ErrorAction Stop
    Write-Host '[PASS] MeshForge files unblocked.' -ForegroundColor Green
} catch {
    Write-Warning "Could not unblock every project file: $($_.Exception.Message)"
    Write-Warning 'Continuing because this launcher already uses ExecutionPolicy Bypass where required.'
}



function Get-DotEnvValue {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [string]$DefaultValue
    )

    $envFile = Join-Path $WorkspaceRoot '.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile |
            Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
            Select-Object -First 1

        if ($line) {
            $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
            if ($value) { return $value }
        }
    }

    return $DefaultValue
}

$ServerPort = [int](Get-DotEnvValue -Name 'SERVER_PORT' -DefaultValue '3333')
$ApiRoot = "http://localhost:$ServerPort"
$ApiHealthUrl = "$ApiRoot/api/v1/health"

function Start-GearProcess {
    param(
        [Parameter(Mandatory=$true)][string]$Title,
        [Parameter(Mandatory=$true)][string]$Command
    )

    $escapedRoot = $WorkspaceRoot.Replace("'", "''")
    $escapedTitle = $Title.Replace("'", "''")
    $launch = @"
`$Host.UI.RawUI.WindowTitle = '$escapedTitle'
Set-Location '$escapedRoot'
`$env:NX_DAEMON = 'false'
`$env:NX_ISOLATE_PLUGINS = 'false'
Write-Host '=== $escapedTitle ===' -ForegroundColor Cyan
Write-Host 'Project: $escapedRoot'
Write-Host ''
$Command
"@

    Start-Process powershell.exe -ArgumentList @(
        '-NoProfile',
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-Command', $launch
    ) | Out-Null
}

function Test-Api {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $ApiHealthUrl -TimeoutSec 2
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    } catch {
        return $false
    }
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ' MeshForge - Start All Programs' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Root: $WorkspaceRoot"
Write-Host "API:  $ApiRoot"
Write-Host ''

$env:NX_DAEMON = 'false'
$env:NX_ISOLATE_PLUGINS = 'false'

if (-not $NoReset) {
    Write-Host '[1/5] Resetting Nx cache...' -ForegroundColor Yellow
    $resetSucceeded = $false
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        & npx --no-install nx reset
        if ($LASTEXITCODE -eq 0) {
            $resetSucceeded = $true
            break
        }

        if ($attempt -lt 2) {
            Write-Warning "Nx reset attempt $attempt failed. Windows may still have .nx\workspace-data locked; retrying once."
            & npx --no-install nx daemon --stop *> $null
            Start-Sleep -Seconds 2
        }
    }

    if (-not $resetSucceeded) {
        Write-Warning 'Nx reset could not clean .nx workspace data (usually a Windows file lock / EPERM).'
        Write-Warning 'Continuing startup with the Nx daemon disabled. Cache reset is maintenance and is not required to run MeshForge.'
    } else {
        Write-Host '[PASS] Nx cache reset completed.' -ForegroundColor Green
    }
} else {
    Write-Host '[1/5] Nx reset skipped.' -ForegroundColor DarkGray
}

$NxWorker = Join-Path $WorkspaceRoot 'node_modules\nx\dist\src\project-graph\plugins\isolation\plugin-worker.js'
if (-not (Test-Path $NxWorker)) {
    throw 'Nx dependencies are not installed. Run commands\SETUP-GEAR-APPS.cmd first.'
}
& node --check $NxWorker *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'The installed Nx plugin-worker file is corrupted. Run commands\SETUP-GEAR-APPS.cmd for a clean reinstall.'
}

$NxVersionOutput = (& npx --no-install nx --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $NxVersionOutput) {
    throw "Nx CLI could not execute from this installation. Run commands\SETUP-GEAR-APPS.cmd again. Output: $NxVersionOutput"
}
Write-Host "[PASS] Nx installation ready: $NxVersionOutput" -ForegroundColor Green

Write-Host ''
Write-Host 'Preparing local UI test login...' -ForegroundColor Yellow
& node "$PSScriptRoot\test-data\ensure-automatic-test-user.mjs"
if ($LASTEXITCODE -ne 0) {
    throw 'Local UI test-user provisioning failed.'
}
Write-Host '[PASS] Local operator account ensured: test@gearapps.local' -ForegroundColor Green
Write-Host '[PASS] Local admin account ensured: admin@gearapps.local' -ForegroundColor Green

if ($ValidateData) {
    Write-Host ''
    Write-Host 'Running safe data validation before startup...' -ForegroundColor Yellow
    & npm run validate:base-data
    if ($LASTEXITCODE -ne 0) { throw 'Base-data validation failed.' }
    & npm run test:data-import
    if ($LASTEXITCODE -ne 0) { throw 'Fresh data-import contract validation failed.' }
    Write-Host '[PASS] Data validation passed.' -ForegroundColor Green
}

Write-Host '[2/5] Starting API server...' -ForegroundColor Yellow
if (Test-Api) {
    Write-Host "      API is already responding on port $ServerPort." -ForegroundColor Green
} else {
    Start-GearProcess -Title 'MeshForge - API Server' -Command 'node --env-file=.env node_modules/nx/dist/bin/nx.js serve gear-app-server'

    $deadline = (Get-Date).AddSeconds($ServerWaitSeconds)
    Write-Host '      Waiting for API to respond' -NoNewline
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        Write-Host '.' -NoNewline
        if (Test-Api) { break }
    }
    Write-Host ''

    if (-not (Test-Api)) {
        throw "API did not respond at $ApiHealthUrl within $ServerWaitSeconds seconds. Check the 'MeshForge - API Server' window."
    }
    Write-Host '      API is responding.' -ForegroundColor Green
}

Write-Host '[3/5] Starting Blade Tracking...' -ForegroundColor Yellow
Start-GearProcess -Title 'MeshForge - Blade Tracking' -Command 'npx nx serve blade-tracking'

Write-Host '[4/5] Starting Cutter Builder...' -ForegroundColor Yellow
Start-GearProcess -Title 'MeshForge - Cutter Builder' -Command 'npx nx serve cutter-builder'

Write-Host '[5/5] Starting Green Shed...' -ForegroundColor Yellow
Start-GearProcess -Title 'MeshForge - Green Shed' -Command 'npx nx serve greenshed'

Start-Sleep -Seconds 3

if (-not $NoBrowser) {
    Write-Host ''
    Write-Host 'Opening application pages...' -ForegroundColor Cyan
    @(
        'http://localhost:4200',
        'http://localhost:4201',
        'http://localhost:4202'
    ) | ForEach-Object { Start-Process $_ }
}

Write-Host ''
Write-Host '[PASS] MeshForge startup launched.' -ForegroundColor Green
Write-Host 'API, Blade Tracking, Cutter Builder, and Green Shed are running in separate PowerShell windows.'
Write-Host 'Close those windows (or press Ctrl+C in each) to stop the programs.'
Write-Host ''

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'show-gear-apps-commands.ps1') -Compact

