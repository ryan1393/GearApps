$ErrorActionPreference = "Stop"

$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
Set-Location $WorkspaceRoot

function Get-DotEnvValue([string]$Name, [string]$DefaultValue) {
    $FromProcess = [Environment]::GetEnvironmentVariable($Name)
    if ($FromProcess) { return $FromProcess.Trim() }
    $EnvPath = Join-Path $WorkspaceRoot ".env"
    if (Test-Path -LiteralPath $EnvPath) {
        $Match = Get-Content -LiteralPath $EnvPath |
            Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
            Select-Object -Last 1
        if ($Match) {
            $Value = ($Match -split "=", 2)[1].Trim().Trim('"').Trim("'")
            if ($Value) { return $Value }
        }
    }
    return $DefaultValue
}

# Same settings the deployment uses: TRUCK_LOG_API_BASE_URL, else the published
# TRUCK_LOG_API_PORT. The template's localhost:3334 base URL does not override
# a changed port.
$ApiPort = [int](Get-DotEnvValue "TRUCK_LOG_API_PORT" "3334")
$DefaultApiBase = "http://localhost:$ApiPort/api/v1"
$ConfiguredApiBase = Get-DotEnvValue "TRUCK_LOG_API_BASE_URL" ""
$ApiBase = if ($ConfiguredApiBase -and -not ($ConfiguredApiBase.TrimEnd("/") -eq "http://localhost:3334/api/v1" -and $ApiPort -ne 3334)) {
    $ConfiguredApiBase.TrimEnd("/")
} else {
    $DefaultApiBase
}

$Boundary = Join-Path $WorkspaceRoot "data\rxo\latest\truck-log-ingestion-boundary.json"
if (-not (Test-Path -LiteralPath $Boundary -PathType Leaf)) {
    throw "RXO boundary not found. Run SYNC-RXO-LATEST-TO-TRUCK-LOG.cmd first: $Boundary"
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " TRUCK LOG RXO POSTGRES IMPORT" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Boundary: $Boundary"
Write-Host "API:      $ApiBase/rxo/import-latest"
Write-Host ""

try {
    $Result = Invoke-RestMethod `
        -Method Post `
        -Uri "$ApiBase/rxo/import-latest" `
        -ContentType "application/json" `
        -TimeoutSec 600
}
catch {
    $Body = $null
    try {
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $Body = $_.ErrorDetails.Message
        }
    }
    catch {
        # Keep the original API failure.
    }

    $Detail = if ($Body) { " API response: $Body" } else { "" }
    throw "Truck Log API RXO import failed. Make sure START-TRUCK-LOG.cmd is running. The verified XLSX snapshot remains safe in data\rxo\latest. $($_.Exception.Message)$Detail"
}

Write-Host "[PASS] RXO latest snapshot imported into PostgreSQL." -ForegroundColor Green
$Result | ConvertTo-Json -Depth 12

# The API's Docker deployment sees the RXO bind mount read-only by design.
# Annotate the local boundary from this host-side bridge instead. PostgreSQL is
# authoritative; annotation failure is only a warning.
try {
    $BoundaryObject = Get-Content -LiteralPath $Boundary -Raw | ConvertFrom-Json
    $BoundaryObject | Add-Member -NotePropertyName postgresImported -NotePropertyValue $true -Force
    $BoundaryObject | Add-Member -NotePropertyName postgresImportedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString("o")) -Force
    $BoundaryObject | Add-Member -NotePropertyName postgresImportSummary -NotePropertyValue $Result -Force

    $TempBoundary = "$Boundary.tmp"
    $BoundaryObject | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $TempBoundary -Encoding UTF8
    Move-Item -LiteralPath $TempBoundary -Destination $Boundary -Force
    Write-Host "[PASS] Local RXO ingestion boundary annotated with PostgreSQL import status." -ForegroundColor Green
}
catch {
    Write-Warning "PostgreSQL import succeeded, but local boundary annotation failed: $($_.Exception.Message)"
}
