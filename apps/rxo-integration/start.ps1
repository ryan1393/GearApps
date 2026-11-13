$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

. "$PSScriptRoot\remote-docker.ps1"

Require-RemoteDocker

Ensure-DockerVolume "truck-log-rxo-data"
Ensure-DockerVolume "truck-log-rxo-state"

Assert-DockerVolumeExists `
    -Name "truck-log-rxo-credentials" `
    -MissingMessage "RXO credentials are not initialized. Run SETUP-RXO-CREDENTIALS.cmd."

Write-Host ""
Write-Host "Starting RXO Fort Wayne automatic filtered export service..."
Write-Host ""

$Started = Invoke-NativeRetry `
    -Description "Start/rebuild RXO recurring export service" `
    -MaxAttempts 5 `
    -InitialDelaySeconds 8 `
    -Command {
        # The ONE root docker-compose.yml (project truck-log, Compose v2). There is
        # no second compose file that could recreate rxo-export with other settings.
        Invoke-RxoCompose -CommandArgs @('up', '-d', '--build', 'rxo-export')
    }

if (-not $Started) {
    throw (
        "Could not start RXO export service after remote-Docker retries."
    )
}

Write-Host ""
Write-Host "[OK] RXO Fort Wayne filtered export service is running."
Write-Host "Default interval: every 30 minutes."
Write-Host ""
Write-Host "Watch live with LOGS-RXO-EXPORT.cmd"
