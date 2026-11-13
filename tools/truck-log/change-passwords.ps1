[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('database','print-secret','all-generated')]
    [string]$Action
)

# Changes generated Truck Log secrets after the first-time setup. Never deletes data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker.exe was not found.' }
. (Join-Path $PSScriptRoot 'compose-common.ps1')
Resolve-TruckLogCompose
if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) { throw 'No .env in this folder. Run SETUP-TRUCK-LOG.cmd first.' }

function Get-RandomHex([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Get-EnvValue([string]$Key) {
    $found = @([System.IO.File]::ReadAllLines((Join-Path $Root '.env')) | Where-Object { $_.StartsWith("$Key=") })
    if ($found.Count -gt 1) { throw "Duplicate .env key: $Key" }
    if ($found.Count -eq 0) { return '' }
    return $found[0].Substring($Key.Length + 1).Trim().Trim('"').Trim("'")
}

function Set-EnvValue([string]$Key, [string]$Value) {
    $path = Join-Path $Root '.env'
    $lines = New-Object System.Collections.Generic.List[string]
    $replaced = $false
    foreach ($line in [System.IO.File]::ReadAllLines($path)) {
        if ($line.StartsWith("$Key=")) {
            if ($replaced) { throw "Duplicate .env key: $Key" }
            $lines.Add("$Key=$Value") | Out-Null
            $replaced = $true
        } else { $lines.Add($line) | Out-Null }
    }
    if (-not $replaced) { $lines.Add("$Key=$Value") | Out-Null }
    $temp = "$path.$PID.tmp"
    [System.IO.File]::WriteAllLines($temp, $lines, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $path -Force
}

function Set-DatabasePassword {
    $user = Get-EnvValue 'TRUCK_LOG_DATABASE_USERNAME'
    $name = Get-EnvValue 'TRUCK_LOG_DATABASE_NAME'
    if (-not $name) { $name = 'TruckLog' }
    # The role name is written into SQL below, so accept only a plain identifier.
    if ($user -notmatch '^[A-Za-z0-9_]+$') { throw 'TRUCK_LOG_DATABASE_USERNAME in .env must be a plain name (letters, digits, underscore).' }
    $state = [string](& { $ErrorActionPreference = 'Continue'; & docker inspect --format '{{.State.Running}}' truck-log-postgres 2>$null })
    if ($state.Trim() -ne 'true') { throw 'The truck-log-postgres container is not running. Run START-TRUCK-LOG.cmd first.' }
    $new = Get-RandomHex 32
    # Sent on standard input so the password never appears in a process list. The
    # connection is local inside the database container and does not need the old password.
    $sql = 'ALTER ROLE "' + $user + '" WITH PASSWORD ''' + $new + ''';'
    $sql | & docker exec -i truck-log-postgres psql -v ON_ERROR_STOP=1 -q -U $user -d $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not accept the change. Nothing was changed; .env is untouched.' }
    Set-EnvValue 'TRUCK_LOG_DATABASE_PASSWORD' $new
    Write-Host '[PASS] Database password changed in PostgreSQL and .env.' -ForegroundColor Green
}

function Set-PrintSecret {
    Set-EnvValue 'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET' (Get-RandomHex 32)
    Write-Host '[PASS] Print Agent claim-token signing secret replaced in .env.' -ForegroundColor Green
    Write-Host '       Print jobs claimed in the last few minutes are retried by their agent.'
}

switch ($Action) {
    'database'      { Set-DatabasePassword }
    'print-secret'  { Set-PrintSecret }
    'all-generated' { Set-DatabasePassword; Set-PrintSecret }
}

Write-Host "`n==> Restarting Truck Log with the new values (data volumes are kept)" -ForegroundColor Cyan
# An HTTPS installation must keep its overlay, or the restart would publish plain HTTP again.
if ((Get-EnvValue 'TRUCK_LOG_ADMIN_TRANSPORT') -eq 'https') {
    Invoke-TruckLogCompose -CommandArgs @('--env-file','.env','-f','docker-compose.yml','-f','docker-compose.https.yml','up','-d') | Out-Null
} else {
    Invoke-TruckLogCompose -CommandArgs @('up','-d') | Out-Null
}
Write-Host "`nPASS - done. Check health with STATUS-TRUCK-LOG.cmd." -ForegroundColor Green
Write-Host 'The .env in this folder now holds the new values; keep using it for later deployments.'
