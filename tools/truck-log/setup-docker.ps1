[CmdletBinding()]
param(
    [switch]$NoStart,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root

function Write-Step([string]$Text) {
    Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Get-RandomHex([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trim = $line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }
        if ($trim -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
        $key = $Matches[1]
        if ($map.ContainsKey($key)) { throw "Duplicate .env key: $key" }
        $value = $Matches[2].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $map[$key] = $value
    }
    return $map
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
    if ($Value -match "[\r\n]") { throw "Invalid multiline value for $Key" }
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [System.IO.File]::ReadAllLines($Path)) { $lines.Add($line) | Out-Null }
    }
    # Not $matches: that is PowerShell's automatic -match result (a hashtable).
    $hits = New-Object System.Collections.Generic.List[int]
    $keyPattern = '^' + [regex]::Escape($Key) + '='
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ([regex]::IsMatch($lines[$i], $keyPattern)) { $hits.Add($i) }
    }
    if ($hits.Count -gt 1) { throw "Duplicate .env key: $Key" }
    $replacement = "$Key=$Value"
    if ($hits.Count -eq 1) { $lines[$hits[0]] = $replacement }
    else {
        if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne '') { $lines.Add('') | Out-Null }
        $lines.Add($replacement) | Out-Null
    }
    $temp = "$Path.$PID.tmp"
    [System.IO.File]::WriteAllLines($temp, $lines, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Invoke-Docker([string[]]$CommandArgs, [switch]$AllowFailure) {
    & docker @CommandArgs
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) { throw "docker $($CommandArgs -join ' ') failed with exit code $code" }
    return $code
}

. (Join-Path $PSScriptRoot 'compose-common.ps1')

function Get-WebPort {
    $map = Read-EnvMap '.env'
    $port = if ($map.ContainsKey('TRUCK_LOG_WEB_PORT') -and $map['TRUCK_LOG_WEB_PORT']) { $map['TRUCK_LOG_WEB_PORT'] } else { '4300' }
    if ($port -notmatch '^[0-9]{1,5}$') { throw "TRUCK_LOG_WEB_PORT must be a port number; got '$port'." }
    return $port
}

function Get-PublicOrigin {
    $existing = Read-EnvMap '.env'
    $webPort = Get-WebPort
    # .env.example ships localhost for local Docker installs. When the selected
    # Docker context is remote, that placeholder is NOT an explicit deployment
    # address. Prefer the remote SSH/TCP host instead. Preserve any non-default
    # origin entered by the operator (including an HTTPS reverse proxy).
    if ($existing.ContainsKey('TRUCK_LOG_PUBLIC_ORIGIN') -and
        $existing['TRUCK_LOG_PUBLIC_ORIGIN'] -and
        $existing['TRUCK_LOG_PUBLIC_ORIGIN'] -ne 'http://localhost:4300' -and
        $existing['TRUCK_LOG_PUBLIC_ORIGIN'] -ne "http://localhost:$webPort") {
        return $existing['TRUCK_LOG_PUBLIC_ORIGIN']
    }
    try {
        $context = (& docker context show).Trim()
        if ($LASTEXITCODE -eq 0 -and $context) {
            $endpointJson = (& docker context inspect $context --format '{{json .Endpoints.docker.Host}}').Trim()
            if ($LASTEXITCODE -eq 0 -and $endpointJson) {
                $endpoint = $endpointJson | ConvertFrom-Json
                if ($endpoint -match '^(ssh|tcp)://') {
                    $uri = [Uri]$endpoint
                    if ($uri.Host) {
                        $hostPart = if ($uri.Host.Contains(':')) { "[$($uri.Host)]" } else { $uri.Host }
                        return "http://${hostPart}:$webPort"
                    }
                }
            }
        }
    } catch {}
    return "http://localhost:$webPort"
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host '  Truck Log - Docker Setup' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host 'Safe setup: no database reset, no volume deletion, no Docker prune.'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'docker.exe was not found. Install Docker Desktop/CLI and select the Linux Docker context, then rerun this file.'
}
Resolve-TruckLogCompose

Write-Step 'Checking selected Docker engine'
$context = (& docker context show).Trim()
if ($LASTEXITCODE -ne 0 -or -not $context) { throw 'Could not determine the selected Docker context.' }
$osType = (& docker info --format '{{.OSType}}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not reach the selected Docker engine.' }
if ($osType -ne 'linux') { throw "Truck Log requires a Linux Docker engine. Selected engine type: $osType" }
$serverVersion = (& docker info --format '{{.ServerVersion}}').Trim()
Write-Host "[PASS] Docker context: $context; Linux engine: $serverVersion; Compose: $script:TruckLogComposeMode $script:TruckLogComposeVersion" -ForegroundColor Green

Write-Step 'Checking for an older Truck Log install'
Assert-NoForeignTruckLogResources
Write-Host '[PASS] No containers or volumes from another Truck Log install.' -ForegroundColor Green

Write-Step 'Preparing local .env'
if (-not (Test-Path -LiteralPath '.env.example')) { throw '.env.example is missing.' }
$freshEnv = $false
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    $freshEnv = $true
    Write-Host '[PASS] Created .env from .env.example.' -ForegroundColor Green
}
# A brand-new .env next to an existing database volume means the volume came from
# another install (for example a 0.1 test build) with a different password.
if ($freshEnv) {
    & { $ErrorActionPreference = 'Continue'; & docker volume inspect truck-log-postgres-data *> $null }
    if ($LASTEXITCODE -eq 0) {
        Remove-Item -LiteralPath '.env' -Force
        throw @"
An existing truck-log-postgres-data volume was found, but this folder has no .env.
It was created by another Truck Log install (for example a 0.1 test build) with a different password.
If you need that data, copy that install's .env into this folder and run setup again.
If it is only test data, run REMOVE-OLD-TRUCK-LOG-INSTALL.cmd -All,
then run setup again.
"@
    }
}
$envMap = Read-EnvMap '.env'
$dbPassword = if ($envMap.ContainsKey('TRUCK_LOG_DATABASE_PASSWORD')) { $envMap['TRUCK_LOG_DATABASE_PASSWORD'] } else { '' }
if (-not $dbPassword -or $dbPassword -match '^(CHANGE_ME|api)$') {
    Set-EnvValue '.env' 'TRUCK_LOG_DATABASE_PASSWORD' (Get-RandomHex 32)
    Write-Host '[PASS] Generated a database password in .env.' -ForegroundColor Green
}
$envMap = Read-EnvMap '.env'
$claim = if ($envMap.ContainsKey('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET')) { $envMap['TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET'] } else { '' }
if (-not $claim) {
    Set-EnvValue '.env' 'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET' (Get-RandomHex 32)
    Write-Host '[PASS] Generated Print Agent claim-token signing secret in .env.' -ForegroundColor Green
} elseif ($claim -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET must be exactly 64 hexadecimal characters.'
}
Set-EnvValue '.env' 'TRUCK_LOG_DATABASE_HOST' 'truck-log-postgres'
Set-EnvValue '.env' 'TRUCK_LOG_DATABASE_PORT' '5432'
Set-EnvValue '.env' 'TRUCK_LOG_DATABASE_SYNCHRONIZE' 'false'
Set-EnvValue '.env' 'TRUCK_LOG_RELEASE' ((Get-Content -LiteralPath (Join-Path $Root 'VERSION') -Raw).Trim())
$origin = Get-PublicOrigin
Set-EnvValue '.env' 'TRUCK_LOG_PUBLIC_ORIGIN' $origin
$envMap = Read-EnvMap '.env'
$cors = if ($envMap.ContainsKey('TRUCK_LOG_CORS_ORIGINS')) { $envMap['TRUCK_LOG_CORS_ORIGINS'] } else { '' }
$localOrigin = "http://localhost:$(Get-WebPort)"
if (-not $cors -or $cors -eq 'http://localhost:4300' -or $cors -eq $localOrigin) {
    $corsValue = if ($origin -eq $localOrigin) { $origin } else { "$localOrigin,$origin" }
    Set-EnvValue '.env' 'TRUCK_LOG_CORS_ORIGINS' $corsValue
}
Write-Host "[PASS] Public origin: $origin" -ForegroundColor Green

Write-Step 'Using Compose-managed named volumes and private network'
Write-Host '[PASS] Docker Compose creates missing resources on the selected Linux host and reuses existing volumes.' -ForegroundColor Green

Write-Step 'Validating Docker Compose configuration'
Invoke-TruckLogCompose -CommandArgs @('config','--quiet') | Out-Null
Write-Host '[PASS] Compose configuration is valid.' -ForegroundColor Green

if ($NoStart) {
    Write-Host "`n[PASS] Setup preparation complete. No containers were built or started." -ForegroundColor Green
    Write-Host 'Next: START-TRUCK-LOG.cmd'
    exit 0
}

Write-Step 'Building and starting Truck Log'
$upArgs = @('up','-d')
if (-not $SkipBuild) { $upArgs += '--build' }
Invoke-TruckLogCompose -CommandArgs $upArgs | Out-Null

Write-Step 'Waiting for core services to become healthy'
$deadline = (Get-Date).AddMinutes(6)
$lastServer = ''
$lastWeb = ''
do {
    Start-Sleep -Seconds 5
    $lastServer = ([string](& { $ErrorActionPreference = 'Continue'; & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' truck-log-server 2>$null })).Trim()
    $lastWeb = ([string](& { $ErrorActionPreference = 'Continue'; & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' truck-log-web 2>$null })).Trim()
    Write-Host "  API=$lastServer  WEB=$lastWeb"
    if ($lastServer -eq 'healthy' -and $lastWeb -eq 'healthy') { break }
} while ((Get-Date) -lt $deadline)

if ($lastServer -ne 'healthy' -or $lastWeb -ne 'healthy') {
    Write-Host ''
    Write-Host '[FAIL] Core services did not become healthy before the timeout.' -ForegroundColor Red
    Invoke-TruckLogCompose -CommandArgs @('ps') -AllowFailure | Out-Null
    Write-Host 'Run LOGS-TRUCK-LOG.cmd for diagnostics.'
    exit 1
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host 'PASS - TRUCK LOG INITIAL SETUP COMPLETE' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host "Truck Log: $origin"
Write-Host 'Standard RXO credentials: SETUP-RXO-INTEGRATION-CREDENTIALS.cmd'
Write-Host 'RXO Expedite credentials: SETUP-RXO-EXPEDITE-CREDENTIALS.cmd'
Write-Host 'If standard RXO requires interactive login/MFA: BOOTSTRAP-RXO-BROWSER.cmd (requires Node.js 20+ on this workstation)'
Write-Host 'No database or Docker volume was deleted.'
