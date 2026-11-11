[CmdletBinding()]
param(
    [string]$SummaryId,
    [string]$PartTypeId
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $ProjectRoot

$fixtureScript = Join-Path $PSScriptRoot 'ensure-workflow-test-fixtures.mjs'
$envFile = Join-Path $ProjectRoot '.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw "MeshForge .env file not found: $envFile"
}

$requiredDbKeys = @(
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_USERNAME',
    'DATABASE_PASSWORD',
    'DATABASE_NAME'
)

$envText = Get-Content -LiteralPath $envFile
$missingDbKeys = @()
foreach ($key in $requiredDbKeys) {
    $line = $envText | Where-Object { $_ -match "^\s*$([regex]::Escape($key))\s*=" } | Select-Object -First 1
    if (-not $line) {
        $missingDbKeys += $key
        continue
    }

    $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if ([string]::IsNullOrWhiteSpace($value)) {
        $missingDbKeys += $key
    }
}

if ($missingDbKeys.Count -gt 0) {
    throw "Missing database setting(s) in .env: $($missingDbKeys -join ', ')"
}

$argsList = @($fixtureScript, '--allowFakeReferenceData')

if ($SummaryId -or $PartTypeId) {
    if (-not $SummaryId -or -not $PartTypeId) {
        throw 'Supply both -SummaryId and -PartTypeId, or omit both.'
    }
    $argsList += @('--summaryId', $SummaryId, '--partTypeId', $PartTypeId)
}

$raw = & node @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Blade Tracking fake-data provisioning failed with exit code $LASTEXITCODE."
}

$data = ($raw | Out-String).Trim() | ConvertFrom-Json

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' Blade Tracking Fake/Test Data' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "Summary:           $($data.summary_number)"
Write-Host "Part type:         $($data.part_type_code)"
Write-Host "Source tray:       $($data.source_tray_serial_number)"
Write-Host "Intake tray:       $($data.blade_tracking.intake_tray_serial_number)"
Write-Host "Coater container:  $($data.blade_tracking.container_serial_number)"
Write-Host "Internal loc A:    $($data.blade_tracking.internal_location_a)"
Write-Host "Internal loc B:    $($data.blade_tracking.internal_location_b)"
Write-Host "Finished shelf:    $($data.shelves.finished)"
Write-Host "Dull shelf:        $($data.shelves.dull)"
Write-Host "Green Shed shelf:  $($data.shelves.greenshed)"
Write-Host ''
Write-Host '[PASS] Blade Tracking fake/test data is ready.' -ForegroundColor Green
