param(
    [string]$SqlServer = "usftwplvsql01",
    [string]$SqlDatabase = "GearAppsNew",
    [switch]$Apply,
    [switch]$KeepFreshExports
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) { throw $Message }
function Pass([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Step([string]$Message) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$WorkRoot = Join-Path $ProjectRoot 'tools\data-import\work'
$BaseFresh = Join-Path $WorkRoot 'base-sql-fresh'
$HistoryFresh = Join-Path $WorkRoot 'cutter-history-fresh'
$BaseExporter = Join-Path $PSScriptRoot 'export-base-data-FRESH-SAFE.ps1'
$HistoryExporter = Join-Path $ProjectRoot 'tools\cutter-history\export-cutter-history-FRESH-SAFE.ps1'
$BaseValidator = Join-Path $ProjectRoot 'tools\base-data\validate-cutter-reference-data.mjs'
$BaseImporter = Join-Path $ProjectRoot 'tools\base-data\import-base-data.mjs'
$HistoryImporter = Join-Path $ProjectRoot 'tools\cutter-history\import-cutter-history-DYNAMIC-FAST-AUDITED.mjs'
$SupplementalDir = Join-Path $ProjectRoot 'tools\base-data\data'
$Workbook = Join-Path $ProjectRoot 'tools\base-data\source\cutter-body-info-BASE-DATA-READY.xlsx'

$SupplementalFiles = @(
    'summary_additions.json',
    'cutter_blade_requirements.json',
    'cutter_body_definitions.json',
    'cutter_bodies.json'
)

Write-Host ""
Write-Host "################################################################" -ForegroundColor Cyan
Write-Host " Gear Apps - FRESH SQL SERVER + EXCEL DATA IMPORT" -ForegroundColor Cyan
Write-Host "################################################################" -ForegroundColor Cyan
Write-Host "SQL Server source : $SqlServer / $SqlDatabase"
Write-Host "PostgreSQL target : values from project .env"
Write-Host "Mode              : $(if ($Apply) {'APPLY'} else {'SAFE PREFLIGHT / DRY RUN'})"
Write-Host ""
Write-Host "This workflow imports:" -ForegroundColor Cyan
Write-Host "  - fresh departments, employees, machines, models, summaries"
Write-Host "  - fresh gears/RING and pinions/PINION"
Write-Host "  - fresh SQL Server pull reasons"
Write-Host "  - fresh cutter builds, central log, setups, frequency, pulls/retired history"
Write-Host "  - Excel-derived summary additions"
Write-Host "  - Excel-derived Summary + Part Type blade requirements"
Write-Host "  - Excel-derived cutter-body definitions"
Write-Host "  - Excel-derived MF/Dana cutter-body mappings"
Write-Host ""
if (-not $Apply) {
    Write-Host "SAFE MODE: SQL Server will only be READ. PostgreSQL will NOT be changed." -ForegroundColor Yellow
} else {
    Write-Host "APPLY MODE: PostgreSQL base/reference data and cutter history WILL be updated." -ForegroundColor Red
}
Write-Host "SQL Server is read-only in both modes." -ForegroundColor Green

Step "Preflight"
foreach ($cmd in @('sqlcmd','node')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Fail "$cmd is required and was not found in PATH."
    }
}
foreach ($file in @($BaseExporter,$HistoryExporter,$BaseValidator,$BaseImporter,$HistoryImporter,$Workbook)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        Fail "Required file is missing: $file"
    }
}
foreach ($name in $SupplementalFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $SupplementalDir $name) -PathType Leaf)) {
        Fail "Required Excel-derived supplemental data is missing: $name"
    }
}
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
Pass "Required commands, importers, workbook, and supplemental JSON are present"

Step "Fresh SQL Server base/reference export"
& $BaseExporter -SqlServer $SqlServer -SqlDatabase $SqlDatabase -OutputDirectory $BaseFresh
if ($LASTEXITCODE -ne 0) { Fail "Fresh base-data export failed." }
Pass "Fresh SQL Server base/reference snapshot ready"

Step "Merging Excel-derived reference data into fresh base snapshot"
foreach ($name in $SupplementalFiles) {
    Copy-Item -LiteralPath (Join-Path $SupplementalDir $name) `
        -Destination (Join-Path $BaseFresh $name) -Force
    Write-Host "  + $name"
}

$workbookHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Workbook).Hash.ToLowerInvariant()
$supplementCounts = [ordered]@{}
foreach ($name in $SupplementalFiles) {
    $parsed = Get-Content -LiteralPath (Join-Path $BaseFresh $name) -Raw | ConvertFrom-Json
    $supplementCounts[$name] = @($parsed).Count
}
$supplementManifest = [ordered]@{
    generated_at = (Get-Date).ToString('o')
    source_workbook = 'tools/base-data/source/cutter-body-info-BASE-DATA-READY.xlsx'
    source_workbook_sha256 = $workbookHash
    supplemental_counts = $supplementCounts
}
$supplementManifest | ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath (Join-Path $BaseFresh 'excel-supplement-manifest.json') -Encoding utf8

Write-Host "  Workbook SHA256: $workbookHash"
$supplementCounts.GetEnumerator() | ForEach-Object {
    Write-Host ("  {0,-36} {1}" -f $_.Key, $_.Value)
}
Pass "Fresh SQL export + Excel-derived supplemental base package assembled"

Step "Validating combined base/reference package"
Push-Location $ProjectRoot
try {
    & node $BaseValidator $BaseFresh
    if ($LASTEXITCODE -ne 0) { Fail "Combined base-data validation failed." }
}
finally { Pop-Location }
Pass "Combined base/reference validation passed"

Step "Fresh SQL Server cutter-history export"
& $HistoryExporter -SqlServer $SqlServer -SqlDatabase $SqlDatabase -OutputDirectory $HistoryFresh
if ($LASTEXITCODE -ne 0) { Fail "Fresh cutter-history export failed." }
Pass "Fresh cutter-history snapshot ready"

if (-not $Apply) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host " FRESH DATA PREFLIGHT PASSED" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "No PostgreSQL data was changed." -ForegroundColor Green
    Write-Host "The cutter-history target reconciliation runs only after the fresh base/reference package is applied," -ForegroundColor Yellow
    Write-Host "so new Excel summaries/requirements are available before history is checked." -ForegroundColor Yellow
    Write-Host "Fresh SQL Server snapshots are staged under:"
    Write-Host "  $BaseFresh"
    Write-Host "  $HistoryFresh"
    Write-Host ""
    Write-Host "To perform the import after reviewing this output:" -ForegroundColor Cyan
    Write-Host "  npm run import:all-fresh -- -Apply" -ForegroundColor White
    exit 0
}

Step "APPLY: importing fresh base/reference + Excel data to PostgreSQL"
Push-Location $ProjectRoot
try {
    & node $BaseImporter $BaseFresh
    if ($LASTEXITCODE -ne 0) {
        Fail "Base/reference import failed. Cutter history was NOT applied."
    }
}
finally { Pop-Location }
Pass "Fresh SQL Server base + Excel reference data imported"

Step "APPLY: re-running cutter-history dry-run after base import"
Push-Location $ProjectRoot
try {
    & node $HistoryImporter $HistoryFresh
    if ($LASTEXITCODE -ne 0) {
        Fail "Post-base cutter-history dry-run failed. Cutter history was NOT refreshed."
    }
}
finally { Pop-Location }
Pass "Post-base cutter-history reconciliation passed"

Step "APPLY: refreshing cutter history from the same fresh SQL Server snapshot"
Push-Location $ProjectRoot
try {
    & node $HistoryImporter $HistoryFresh --apply
    if ($LASTEXITCODE -ne 0) {
        Fail "Cutter-history apply failed. The history importer rolls back its transaction on failure."
    }
}
finally { Pop-Location }
Pass "Fresh cutter history imported"

Step "Final reference-data validation"
Push-Location $ProjectRoot
try {
    & node $BaseValidator $BaseFresh
    if ($LASTEXITCODE -ne 0) { Fail "Final base-data validation failed." }
}
finally { Pop-Location }
Pass "Final reference validation passed"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " FRESH ALL-DATA IMPORT COMPLETE" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "SQL Server source : $SqlServer / $SqlDatabase"
Write-Host "Base snapshot     : $BaseFresh"
Write-Host "History snapshot  : $HistoryFresh"
Write-Host "Workbook SHA256   : $workbookHash"
Write-Host ""
Write-Host "The SQL Server source was never modified." -ForegroundColor Cyan

if (-not $KeepFreshExports) {
    Write-Host "Fresh snapshots were retained for audit/reconciliation." -ForegroundColor Yellow
    Write-Host "Use them to prove exactly what source data was imported." -ForegroundColor Yellow
}
