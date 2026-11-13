$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

. "$PSScriptRoot\remote-docker.ps1"

Write-Host ""
Write-Host "============================================================"
Write-Host " RXO LATEST FORT WAYNE OUTPUT VERIFICATION"
Write-Host "============================================================"
Write-Host ""
Write-Host "Read-only verification with remote-Docker retry protection."
Write-Host ""

Require-RemoteDocker

$Verified = Invoke-NativeRetry `
    -Description "Verify latest six Fort Wayne exports" `
    -MaxAttempts 5 `
    -InitialDelaySeconds 5 `
    -Command {
        Invoke-RxoCompose -CommandArgs @(
            'run', '-T', '--rm', '--no-deps',
            '-e', 'RXO_SYNC_ON_START=false',
            'rxo-export',
            'node', 'src/rxo-fort-wayne-export.mjs', '--verify-latest'
        )
    }

if (-not $Verified) {
    throw (
        "RXO latest-output verification could not complete after remote-Docker retries."
    )
}

Write-Host ""
Write-Host "============================================================"
Write-Host " ALL 6 RXO FORT WAYNE EXPORTS VERIFIED"
Write-Host "============================================================"
