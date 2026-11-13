$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

. "$PSScriptRoot\remote-docker.ps1"

Write-Host ""
Write-Host "============================================================"
Write-Host " RXO FORT WAYNE PRODUCTION EXPORT - ONE-TIME TEST"
Write-Host "============================================================"
Write-Host ""
Write-Host "Remote-Docker resilient production harness + strict native exit-code handling."
Write-Host "Uses the consolidated Fort Wayne production exporter behavior."
Write-Host "Origin=OUTBOUND; Destination=INBOUND."
Write-Host "Every filter selects 12808 + DANA_USA_FORT_WAYNE_IN."
Write-Host ""

Require-RemoteDocker

Ensure-DockerVolume "truck-log-rxo-data"
Ensure-DockerVolume "truck-log-rxo-state"

Assert-DockerVolumeExists `
    -Name "truck-log-rxo-credentials" `
    -MissingMessage "Missing RXO credential volume. Run SETUP-RXO-CREDENTIALS.cmd first."

Invoke-ComposeBuildRetry `
    -Service "rxo-export"

Write-Host ""
Write-Host "Checking Playwright/Chromium..."

$PreflightPassed = Invoke-NativeRetry `
    -Description "Playwright/Chromium preflight" `
    -MaxAttempts 4 `
    -InitialDelaySeconds 5 `
    -Command {
        Invoke-RxoCompose -CommandArgs @(
            'run', '-T', '--rm', '--no-deps',
            '-e', 'RXO_SYNC_ON_START=false',
            'rxo-export',
            'node', 'src/playwright-preflight.mjs'
        )
    }

if (-not $PreflightPassed) {
    throw (
        "Playwright/Chromium preflight could not complete after remote-Docker retries. " +
        "No RXO export was started."
    )
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RecoveryContainer = "rxo-production-$Timestamp"

$ProductionExitCode = Invoke-ComposeRunRecoverable `
    -ContainerName $RecoveryContainer `
    -Description "Running one production Fort Wayne export batch..." `
    -ContainerCommand @(
        "node",
        "src/rxo-fort-wayne-export.mjs",
        "--once"
    )

if ($ProductionExitCode -ne 0) {
    Write-Host ""
    Write-Host "PRODUCTION EXPORT TEST FAILED." -ForegroundColor Red
    Write-Host "Run EXPORT-RXO-FAILURE.cmd for exporter failure details."

    throw (
        "RXO production container exited with code $ProductionExitCode."
    )
}

Write-Host ""
Write-Host "Exporter completed and verified all six filtered files in-process."
Write-Host "No host-side chain of Docker verification calls is required."

Write-Host ""
Write-Host "============================================================"
Write-Host " RXO FORT WAYNE PRODUCTION EXPORT PASSED"
Write-Host "============================================================"
Write-Host ""
Write-Host "Run EXPORT-RXO-LATEST.cmd to copy latest files to Windows."
