$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "        TRUCK LOG - START" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path "node_modules")) {
    throw "node_modules is missing. Run SETUP-TRUCK-LOG-DEVELOPMENT.cmd first."
}

if (-not (Test-Path -LiteralPath ".env")) {
    throw ".env is missing. Local development requires an explicit reachable PostgreSQL configuration. Copy .env.example, change Docker-only values such as TRUCK_LOG_DATABASE_HOST=truck-log-postgres and TRUCK_LOG_DOCUMENT_STORAGE_ROOT=/data/truck-log-documents for your workstation, or use SETUP-TRUCK-LOG.cmd for the supported Docker runtime."
}
$localEnvText = [System.IO.File]::ReadAllText((Resolve-Path ".env"))
if ($localEnvText -match '(?m)^TRUCK_LOG_DATABASE_HOST=truck-log-postgres\s*$') {
    throw "Local development cannot resolve the Docker-only database hostname 'truck-log-postgres'. Set TRUCK_LOG_DATABASE_HOST to a PostgreSQL host reachable from Windows, or use SETUP-TRUCK-LOG.cmd."
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
if (-not $node) { throw "Node.js was not found in PATH." }

function Get-DotEnvValue([string]$Name, [string]$DefaultValue) {
    $envPath = Join-Path $Root ".env"
    if (Test-Path $envPath) {
        $match = Get-Content -LiteralPath $envPath |
            Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
            Select-Object -Last 1

        if ($match) {
            $value = ($match -split "=", 2)[1].Trim().Trim('"').Trim("'")
            if ($value) { return $value }
        }
    }
    return $DefaultValue
}

$ApiPort = [int](Get-DotEnvValue "TRUCK_LOG_API_PORT" "3334")
$WebPort = [int](Get-DotEnvValue "TRUCK_LOG_WEB_PORT" "4300")

Write-Host "API port: $ApiPort" -ForegroundColor DarkGray
Write-Host "UI port : $WebPort" -ForegroundColor DarkGray

function Resolve-ServerEntry {
    $preferred = Join-Path $Root "dist\apps\truck-log-server\main.js"
    if (Test-Path $preferred) { return (Resolve-Path $preferred).Path }

    $serverDist = Join-Path $Root "dist\apps\truck-log-server"
    if (-not (Test-Path $serverDist)) { return $null }

    $candidates = Get-ChildItem -LiteralPath $serverDist -Filter "main.js" -File -Recurse -ErrorAction SilentlyContinue
    if (-not $candidates) { return $null }

    $ranked = foreach ($file in $candidates) {
        $relative = $file.FullName.Substring($serverDist.Length).TrimStart('\')
        [PSCustomObject]@{
            FullName = $file.FullName
            RelativeLength = $relative.Length
            LastWrite = $file.LastWriteTime
        }
    }

    return ($ranked |
        Sort-Object @{Expression='RelativeLength';Descending=$false},
                    @{Expression='LastWrite';Descending=$true} |
        Select-Object -First 1).FullName
}

function Show-Log([string]$Title, [string]$Path) {
    Write-Host ""
    Write-Host "----- $Title -----" -ForegroundColor Yellow
    if (Test-Path $Path) {
        $lines = Get-Content -LiteralPath $Path -Tail 180 -ErrorAction SilentlyContinue
        if ($lines) { $lines | ForEach-Object { Write-Host $_ } }
        else { Write-Host "(log is empty)" -ForegroundColor DarkGray }
    } else {
        Write-Host "(log file was not created)" -ForegroundColor DarkGray
    }
}

function Test-Http2xx([string]$Url) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
    } catch {
        return $false
    }
}

function Get-ListeningProcess([int]$Port) {
    try {
        return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -First 1
    } catch {
        return $null
    }
}

function Get-ProcessCommandLine([int]$OwnerProcessId) {
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerProcessId" -ErrorAction Stop).CommandLine
    } catch {
        return $null
    }
}

function Stop-StaleTruckLogListener([int]$Port, $Listener) {
    if (-not $Listener) { return $true }

    $ownerProcessId = [int]$Listener.OwningProcess
    $commandLine = Get-ProcessCommandLine $ownerProcessId
    $rootNormalized = $Root.ToLowerInvariant()
    $commandNormalized = if ($commandLine) { $commandLine.ToLowerInvariant() } else { "" }

    $belongsToTruckLog = $commandNormalized.Contains($rootNormalized) -or
                         $commandNormalized.Contains("truck-log") -or
                         $commandNormalized.Contains("nx serve truck-log")

    if (-not $belongsToTruckLog) {
        Write-Host ""
        Write-Host "[BLOCKED] Port $Port is occupied by PID $ownerProcessId, and it does not look like this Truck Log project." -ForegroundColor Red
        if ($commandLine) {
            Write-Host "Command line:" -ForegroundColor Yellow
            Write-Host "  $commandLine" -ForegroundColor DarkGray
        }
        return $false
    }

    Write-Host "[INFO] Stale Truck Log process detected on port $Port (PID $ownerProcessId)." -ForegroundColor Yellow
    Write-Host "       Closing that Truck Log process tree before restart..." -ForegroundColor Yellow

    & taskkill.exe /PID $ownerProcessId /T /F | Out-Null
    Start-Sleep -Seconds 2

    return (-not (Get-ListeningProcess $Port))
}

$serverEntry = Resolve-ServerEntry
if (-not $serverEntry) {
    throw "No compiled NestJS main.js was found under dist\apps\truck-log-server. Run SETUP-TRUCK-LOG-DEVELOPMENT.cmd first."
}

Write-Host "[OK] Compiled API entry:" -ForegroundColor Green
Write-Host "     $serverEntry" -ForegroundColor DarkGray

$Logs = Join-Path $Root ".runtime-logs"
New-Item -ItemType Directory -Path $Logs -Force | Out-Null

$serverOut = Join-Path $Logs "server.stdout.log"
$serverErr = Join-Path $Logs "server.stderr.log"
$webOut = Join-Path $Logs "web.stdout.log"
$webErr = Join-Path $Logs "web.stderr.log"

Remove-Item $serverOut,$serverErr,$webOut,$webErr -Force -ErrorAction SilentlyContinue

$liveness = "http://localhost:$ApiPort/api/v1/health/live"
$readiness = "http://localhost:$ApiPort/api/v1/health"
$webUrl = "http://localhost:$WebPort"

Write-Host ""
Write-Host "Starting compiled NestJS API directly with Node..." -ForegroundColor Cyan

$existingApi = Get-ListeningProcess $ApiPort
$serverProcess = $null

# START-TRUCK-LOG is a real restart. Never reuse an already-running Truck Log API:
# doing so can leave an older compiled Nest process serving stale routes after a source change.
if ($existingApi) {
    if (-not (Stop-StaleTruckLogListener $ApiPort $existingApi)) {
        throw "Port $ApiPort is occupied by another application. Close PID $($existingApi.OwningProcess) or choose another TRUCK_LOG_API_PORT."
    }
}

$serverProcess = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @($serverEntry) `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $serverOut `
    -RedirectStandardError $serverErr `
    -WindowStyle Hidden `
    -PassThru

$alive = $false
for ($i = 0; $i -lt 120; $i++) {
    if ($serverProcess.HasExited) { break }
    if (Test-Http2xx $liveness) {
        $alive = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

if (-not $alive) {
    Show-Log "SERVER STDOUT" $serverOut
    Show-Log "SERVER STDERR" $serverErr
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    throw "Truck Log API did not become live."
}

Write-Host "[OK] Fresh Truck Log API process started and liveness passed." -ForegroundColor Green

if (Test-Http2xx $readiness) {
    Write-Host "[OK] Database + document storage readiness passed." -ForegroundColor Green
} else {
    Write-Host "[WARN] API is live, but database/truck-log/document readiness is degraded." -ForegroundColor Yellow
}

# Latest-functionality route smoke test. This catches a stale or wrong compiled API
# immediately instead of allowing the Angular UI to fail later with 404 toasts.
foreach ($route in @(
    "http://localhost:$ApiPort/api/v1/scheduled-loads",
    "http://localhost:$ApiPort/api/v1/settings/dock-aging",
    "http://localhost:$ApiPort/api/v1/rxo/status"
)) {
    if (-not (Test-Http2xx $route)) {
        Show-Log "SERVER STDOUT" $serverOut
        Show-Log "SERVER STDERR" $serverErr
        if ($serverProcess -and -not $serverProcess.HasExited) {
            Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        }
        throw "Fresh Truck Log API is missing or failing required route: $route. Re-run the current source build before starting Truck Log."
    }
    Write-Host "[OK] Required API route passed: $route" -ForegroundColor Green
}

Write-Host ""
Write-Host "Starting Angular Truck Log UI on port $WebPort..." -ForegroundColor Cyan

$existingWeb = Get-ListeningProcess $WebPort
$webProcess = $null

# Restart the owned Angular dev server too. This prevents an old UI process from
# surviving a source change simply because localhost:4300 still answers HTTP.
if ($existingWeb) {
    if (-not (Stop-StaleTruckLogListener $WebPort $existingWeb)) {
        throw "Port $WebPort is occupied by another application. Close PID $($existingWeb.OwningProcess) or choose another TRUCK_LOG_WEB_PORT."
    }
}

$escapedRoot = $Root.Replace("'","''")

# Bind and open the UI through localhost; that is the confirmed browser path on this workstation.
$webCommand = "Set-Location -LiteralPath '$escapedRoot'; " +
              "`$env:NX_DAEMON='false'; " +
              "npx --no-install nx serve truck-log --host=localhost --port=$WebPort"

$webProcess = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-Command",$webCommand) `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $webOut `
    -RedirectStandardError $webErr `
    -WindowStyle Hidden `
    -PassThru

$webReady = $false
for ($i = 0; $i -lt 180; $i++) {
    if ($webProcess.HasExited) { break }
    if (Test-Http2xx $webUrl) {
        $webReady = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $webReady) {
    Show-Log "WEB STDOUT" $webOut
    Show-Log "WEB STDERR" $webErr

    if ($webProcess -and -not $webProcess.HasExited) {
        Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue
    }

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }

    throw "Truck Log web app did not become ready on $webUrl."
}

Write-Host "[OK] Fresh Truck Log web process is ready on localhost port $WebPort." -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "        TRUCK LOG IS RUNNING" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host "Web: $webUrl"
Write-Host "API liveness: $liveness"
Write-Host "API readiness: $readiness"
Write-Host "Logs: $Logs"
Write-Host ""

Start-Process $webUrl
