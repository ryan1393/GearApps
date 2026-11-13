$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
. "$PSScriptRoot\remote-docker.ps1"

function Test-DockerVolume([string]$Name) {
    $Names = @(& { $ErrorActionPreference = 'Continue'; & docker volume ls --format "{{.Name}}" 2>$null })
    return ($Names -contains $Name)
}

foreach ($Volume in @(
    "truck-log-rxo-data",
    "truck-log-rxo-state"
)) {
    if (-not (Test-DockerVolume $Volume)) {
        & docker volume create $Volume | Out-Null

        if ($LASTEXITCODE -ne 0) {
            throw "Could not create Docker volume '$Volume'."
        }
    }
}

if (-not (Test-DockerVolume "truck-log-rxo-credentials")) {
    throw "Missing RXO credential volume. Run SETUP-RXO-CREDENTIALS.cmd first."
}

Write-Host ""
Write-Host "============================================================"
Write-Host " RXO FORT WAYNE ASYNC-OPTION TEST"
Write-Host "============================================================"
Write-Host ""
Write-Host "This test does NOT export Orders/Shipments."
Write-Host "This test does NOT normalize data."
Write-Host "This test only proves the Fort Wayne filters."
Write-Host ""
Write-Host "Every tested Origin/Destination filter must select BOTH:"
Write-Host "  12808 (all visible matching rows)"
Write-Host "  DANA_USA_FORT_WAYNE_IN"
Write-Host ""
Write-Host "Pages:"
Write-Host "  Orders"
Write-Host "  Freight On The Move"
Write-Host "  Shipments"
Write-Host ""

Invoke-RxoCompose -CommandArgs @('build', 'rxo-export') | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    throw "Docker image build failed."
}

Write-Host ""
Write-Host "Checking Playwright/Chromium inside the built image..."
Write-Host ""

Invoke-RxoCompose -CommandArgs @(
    'run', '-T', '--rm', '--no-deps',
    '-e', 'RXO_SYNC_ON_START=false',
    'rxo-export',
    'node', 'src/playwright-preflight.mjs'
) | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    throw "Playwright/Chromium container preflight failed."
}

Write-Host ""
Write-Host "[OK] Browser preflight passed. Starting RXO filter test..."
Write-Host ""

Invoke-RxoCompose -CommandArgs @(
    'run', '-T', '--rm', '--no-deps',
    '-e', 'RXO_SYNC_ON_START=false',
    'rxo-export',
    'node', 'src/rxo-filter-test.mjs'
) | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "FORT WAYNE FILTER TEST FAILED." -ForegroundColor Red
    Write-Host ""
    Write-Host "Run:"
    Write-Host "  EXPORT-FILTER-TEST-RESULTS.cmd"
    Write-Host ""
    throw "RXO Fort Wayne filter test failed."
}

Write-Host ""
Write-Host "============================================================"
Write-Host " ALL FORT WAYNE FILTER TESTS PASSED"
Write-Host "============================================================"
Write-Host ""
Write-Host "Run EXPORT-FILTER-TEST-RESULTS.cmd if you want the screenshots/results."


Write-Host ""
Write-Host "Current selector behavior:"
Write-Host "  - Angular Material mat-select / combobox"
Write-Host "  - exact RXO option rows are polled with bounded diagnostics"
Write-Host "  - Orders verify retained selected state"
Write-Host "  - Freight/Shipments can discover the Fort Wayne option when needed"
Write-Host "  - Shipments navigation has bounded recovery retries"
