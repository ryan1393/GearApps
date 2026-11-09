param(
    [string]$SqlServer = "usftwplvsql01",
    [string]$SqlDatabase = "GearAppsNew",
    [switch]$Apply,
    [switch]$YesReallyDeleteOldData,
    [switch]$KeepFreshExports
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) { throw $Message }
function Pass([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Step([string]$Message) {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$FreshWorkflow = Join-Path $PSScriptRoot 'import-all-fresh.ps1'
$TruncateTarget = Join-Path $PSScriptRoot 'truncate-target-postgres.mjs'
$BootstrapSystemReference = Join-Path $PSScriptRoot 'bootstrap-system-reference-data.mjs'
$BaseFresh = Join-Path $ProjectRoot 'tools\data-import\work\base-sql-fresh'
$HistoryFresh = Join-Path $ProjectRoot 'tools\data-import\work\cutter-history-fresh'
$BaseImporter = Join-Path $ProjectRoot 'tools\base-data\import-base-data.mjs'
$BaseValidator = Join-Path $ProjectRoot 'tools\base-data\validate-cutter-reference-data.mjs'
$HistoryImporter = Join-Path $ProjectRoot 'tools\cutter-history\import-cutter-history-DYNAMIC-FAST-AUDITED.mjs'
$EnsureLocalUsers = Join-Path $ProjectRoot 'tools\test-data\ensure-automatic-test-user.mjs'
$SeedMockInventory = Join-Path $PSScriptRoot 'seed-trays-containers-mock-data.mjs'

Write-Host ''
Write-Host '################################################################' -ForegroundColor Cyan
Write-Host ' Gear Apps - DELETE OLD DATA + FULL FRESH REFRESH' -ForegroundColor Cyan
Write-Host '################################################################' -ForegroundColor Cyan
Write-Host "SQL Server source : $SqlServer / $SqlDatabase"
Write-Host 'PostgreSQL target : DATABASE_* values from this project .env'
Write-Host "Mode              : $(if ($Apply) {'DELETE + APPLY'} else {'SAFE PREFLIGHT ONLY'})"
Write-Host ''
Write-Host 'This is a TRUE refresh:' -ForegroundColor Yellow
Write-Host '  1. Export + validate fresh SQL Server/Excel source data FIRST.'
Write-Host '  2. Delete existing PostgreSQL application rows while preserving schema.'
Write-Host '  3. Re-bootstrap required Gear Apps system reference rows.'
Write-Host '  4. Import fresh base/reference data.'
Write-Host '  5. Import fresh cutter history.'
Write-Host '  6. Recreate the local operator/admin test logins.'
Write-Host '  7. Seed 300 T trays + 100 C containers with mixed mock inventory at locations.'
Write-Host ''
Write-Host 'SQL Server is READ-ONLY and is never deleted or modified.' -ForegroundColor Green

Step 'Preflight fresh source export + validation (NO target changes)'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $FreshWorkflow `
    -SqlServer $SqlServer -SqlDatabase $SqlDatabase
if ($LASTEXITCODE -ne 0) { Fail 'Fresh source preflight failed. Target PostgreSQL was NOT deleted.' }
Pass 'Fresh source data exported and validated before any delete'

if (-not $Apply) {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ' SAFE FULL-REFRESH PREFLIGHT PASSED' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host 'Nothing in PostgreSQL was deleted.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'To actually delete the old target data and reload fresh:' -ForegroundColor Cyan
    Write-Host '  npm run refresh:all-data:reset -- -Apply -YesReallyDeleteOldData' -ForegroundColor White
    exit 0
}

if (-not $YesReallyDeleteOldData) {
    Write-Host ''
    Write-Host 'DESTRUCTIVE ACTION BLOCKED.' -ForegroundColor Red
    Write-Host 'This mode intentionally deletes all existing Gear Apps application rows from the target PostgreSQL database.' -ForegroundColor Yellow
    Write-Host 'Close all running Gear Apps API/server windows first.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Re-run with:' -ForegroundColor Cyan
    Write-Host '  npm run refresh:all-data:reset -- -Apply -YesReallyDeleteOldData' -ForegroundColor White
    exit 2
}

Step 'Deleting old PostgreSQL application data'
Push-Location $ProjectRoot
try {
    & node $TruncateTarget --apply
    if ($LASTEXITCODE -ne 0) { Fail 'Target PostgreSQL reset failed.' }
}
finally { Pop-Location }
Pass 'Old target rows deleted; schema preserved'

Step 'Re-bootstrap required Gear Apps system reference data'
Push-Location $ProjectRoot
try {
    & node $BootstrapSystemReference --apply
    if ($LASTEXITCODE -ne 0) { Fail 'System-reference bootstrap failed after reset.' }
}
finally { Pop-Location }
Pass 'Required system references restored after reset'

Step 'Importing the already-validated fresh base/reference snapshot'
Push-Location $ProjectRoot
try {
    & node $BaseImporter $BaseFresh
    if ($LASTEXITCODE -ne 0) { Fail 'Fresh base/reference import failed after reset.' }
}
finally { Pop-Location }
Pass 'Fresh base/reference data imported'

Step 'Reconciling fresh cutter history against the new base data'
Push-Location $ProjectRoot
try {
    & node $HistoryImporter $HistoryFresh
    if ($LASTEXITCODE -ne 0) { Fail 'Fresh cutter-history dry-run failed after reset.' }
}
finally { Pop-Location }
Pass 'Fresh cutter-history reconciliation passed'

Step 'Importing fresh cutter history'
Push-Location $ProjectRoot
try {
    & node $HistoryImporter $HistoryFresh --apply
    if ($LASTEXITCODE -ne 0) { Fail 'Fresh cutter-history apply failed after reset.' }
}
finally { Pop-Location }
Pass 'Fresh cutter history imported'

Step 'Recreating local Gear Apps operator/admin logins'
Push-Location $ProjectRoot
try {
    & node $EnsureLocalUsers
    if ($LASTEXITCODE -ne 0) { Fail 'Local test/admin user recreation failed.' }
}
finally { Pop-Location }
Pass 'Local operator/admin logins recreated with department assignments'

Step 'Seeding reusable T/C inventory with mixed mock data'
Push-Location $ProjectRoot
try {
    & node $SeedMockInventory --apply
    if ($LASTEXITCODE -ne 0) { Fail 'T/C mock-data seed failed.' }
}
finally { Pop-Location }
Pass '300 T trays and 100 C containers are ready with mixed mock data across locations'

Step 'Final validation'
Push-Location $ProjectRoot
try {
    & node $BaseValidator $BaseFresh
    if ($LASTEXITCODE -ne 0) { Fail 'Final fresh-data validation failed.' }
    & node "$ProjectRoot\tools\data-import\test-data-import-contract.mjs"
    if ($LASTEXITCODE -ne 0) { Fail 'Final data-import contract failed.' }
}
finally { Pop-Location }
Pass 'Final refresh validation passed'

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' FULL DATA RESET + FRESH IMPORT COMPLETE' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host 'Old PostgreSQL application data : DELETED'
Write-Host 'Database schema                 : PRESERVED'
Write-Host 'Fresh SQL Server + Excel data  : IMPORTED'
Write-Host 'Fresh cutter history           : IMPORTED'
Write-Host 'Local operator/admin accounts  : RECREATED'
Write-Host 'Reusable trays                  : 300 (T0001 .. T0300)'
Write-Host 'Reusable containers             : 100 (C0001 .. C0100)'
Write-Host 'Mock inventory                  : SEEDED across locations / coater / Green Shed shelves'
Write-Host ''
Write-Host 'Now start Gear Apps normally with commands\START-GEAR-APPS.cmd.' -ForegroundColor Cyan

