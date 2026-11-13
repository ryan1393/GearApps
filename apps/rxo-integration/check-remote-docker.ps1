$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

. "$PSScriptRoot\remote-docker.ps1"

Write-Host ""
Write-Host "============================================================"
Write-Host " RXO REMOTE DOCKER / SSH CONNECTION CHECK"
Write-Host "============================================================"
Write-Host ""

$Context = @(
    & { $ErrorActionPreference = 'Continue'; & docker context show 2>&1 }
)

if ($LASTEXITCODE -eq 0) {
    Write-Host (
        "Docker context: " +
        (($Context | Select-Object -Last 1).ToString().Trim())
    )
}

if (-not (Wait-RemoteDocker -MaxAttempts 8)) {
    Write-Host ""
    Write-Host "REMOTE DOCKER CHECK FAILED." -ForegroundColor Red
    Write-Host "No RXO process was started."
    exit 1
}

Write-Host ""
Write-Host "Remote Docker connection is healthy right now."
Write-Host ""

& { $ErrorActionPreference = 'Continue'; & docker info `
    --format "Server={{.ServerVersion}}  OS={{.OperatingSystem}}  Containers={{.Containers}}" `
    2>&1 }
