param([string]$OutputDirectory = "")
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) { throw "Could not locate Gear repository root." }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = $Root }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$Node = Get-Command node -ErrorAction Stop
$SafePackager = Join-Path $PSScriptRoot 'package-dana-apps-source.ps1'
$ManifestGenerator = Join-Path $PSScriptRoot 'generate-dana-apps-gear-merge-manifest.mjs'
$ManifestContract = Join-Path $PSScriptRoot 'test-dana-apps-gear-merge-manifest-contract.mjs'
$HygieneContract = Join-Path $PSScriptRoot 'test-dana-apps-source-package-hygiene-contract.mjs'
$CompletenessContract = Join-Path $PSScriptRoot 'test-dana-apps-source-package-completeness-contract.mjs'
foreach ($required in @($SafePackager,$ManifestGenerator,$ManifestContract,$HygieneContract,$CompletenessContract)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required Gear handoff tool is missing: $required" }
}
Push-Location $Root
try {
    & $Node.Source $ManifestGenerator
    if ($LASTEXITCODE -ne 0) { throw "Gear merge manifest generation failed with exit code $LASTEXITCODE" }
    & $Node.Source $ManifestContract
    if ($LASTEXITCODE -ne 0) { throw "Gear merge manifest contract failed with exit code $LASTEXITCODE" }
    & $Node.Source $HygieneContract
    if ($LASTEXITCODE -ne 0) { throw "Dana Apps source package hygiene contract failed with exit code $LASTEXITCODE" }
    & $Node.Source $CompletenessContract
    if ($LASTEXITCODE -ne 0) { throw "Dana Apps source package completeness contract failed with exit code $LASTEXITCODE" }
    $ArchivePrefix = 'Dana-Apps-V70.0.0-Fresh-Docker-Ready'
    $PackageStartedUtc = [DateTime]::UtcNow
    try {
        & $SafePackager -OutputDirectory $OutputDirectory -ArchivePrefix $ArchivePrefix
    }
    catch {
        throw "Safe source packager failed: $($_.Exception.Message)"
    }

    $Zip = Get-ChildItem -LiteralPath $OutputDirectory -File -Filter "$ArchivePrefix-FULL-SOURCE-*.zip" |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1

    if ($null -eq $Zip) {
        throw "Could not locate the newly created Gear handoff ZIP."
    }

    if ($Zip.LastWriteTimeUtc -lt $PackageStartedUtc.AddSeconds(-2)) {
        throw "The located Gear handoff ZIP predates this packaging run."
    }
    $ZipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Zip.FullName).Hash
    $ManifestPath = Join-Path $Root 'DANA_APPS_GEAR_MERGE_MANIFEST.json'
    $ManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash
    $HashFile = "$($Zip.FullName).sha256.txt"
    @(
        "Dana Apps source handoff"
        "Baseline: V70.0.0"
        "Archive: $($Zip.Name)"
        "Archive SHA-256: $ZipHash"
        "Manifest: DANA_APPS_GEAR_MERGE_MANIFEST.json"
        "Manifest SHA-256: $ManifestHash"
        "Generated: $((Get-Date).ToString('o'))"
        "npm install required: NO"
    ) | Set-Content -LiteralPath $HashFile -Encoding UTF8
    Write-Host ""
    Write-Host "[PASS] Dana Apps handoff package is ready." -ForegroundColor Green
    Write-Host "ZIP:      $($Zip.FullName)" -ForegroundColor Green
    Write-Host "SHA file: $HashFile" -ForegroundColor Green
    Write-Host "ZIP SHA-256: $ZipHash" -ForegroundColor Green
}
finally { Pop-Location }
