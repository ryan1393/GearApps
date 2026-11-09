$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
. "$PSScriptRoot\remote-docker.ps1"

$StateVolume = "truck-log-rxo-state"

Write-Host ""
Write-Host "Reset ONLY the RXO browser/session state (Docker volume $StateVolume)."
Write-Host "Credentials and exported data are preserved. The next scan signs in again"
Write-Host "with the saved credentials (or run BOOTSTRAP-RXO-BROWSER for an interactive login)."
Write-Host ""

$Answer = Read-Host "Type RESET to delete the RXO browser session"
if ($Answer -cne "RESET") {
    Write-Host "Cancelled. Nothing was changed."
    exit 1
}

Require-RemoteDocker

# `docker volume rm` fails while ANY container (running or stopped) still
# references the volume, so stop and remove exactly those containers first.
$Rows = @(& { $ErrorActionPreference = 'Continue'; & docker ps -a --filter "volume=$StateVolume" --format "{{.ID}}|{{.Names}}|{{.State}}" 2>&1 })
if ($LASTEXITCODE -ne 0) {
    throw "Could not list containers that use $StateVolume."
}

$Users = @(
    foreach ($Row in $Rows) {
        $Parts = $Row.ToString().Trim() -split "\|", 3
        if ($Parts.Count -eq 3 -and $Parts[0]) {
            [pscustomobject]@{ Id = $Parts[0]; Name = $Parts[1]; State = $Parts[2] }
        }
    }
)
$SchedulerWasRunning = @($Users | Where-Object { $_.Name -eq "truck-log-rxo-export" -and $_.State -eq "running" }).Count -gt 0

foreach ($Container in $Users) {
    Write-Host "Removing container $($Container.Name) ($($Container.State)) that uses $StateVolume..."
    & { $ErrorActionPreference = 'Continue'; & docker stop $Container.Id 2>&1 } | Out-Null
    & { $ErrorActionPreference = 'Continue'; & docker rm $Container.Id 2>&1 } | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not remove container $($Container.Name). The session volume was NOT deleted."
    }
}

& { $ErrorActionPreference = 'Continue'; & docker volume inspect $StateVolume *> $null }
if ($LASTEXITCODE -eq 0) {
    & { $ErrorActionPreference = 'Continue'; & docker volume rm $StateVolume 2>&1 } | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "docker volume rm $StateVolume failed. The RXO session was NOT reset."
    }
    & { $ErrorActionPreference = 'Continue'; & docker volume inspect $StateVolume *> $null }
    if ($LASTEXITCODE -eq 0) {
        throw "$StateVolume still exists after removal. The RXO session was NOT reset."
    }
}
else {
    Write-Host "$StateVolume did not exist; creating a fresh one."
}

& docker volume create $StateVolume | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not recreate $StateVolume."
}

if ($SchedulerWasRunning) {
    Write-Host "Recreating the RXO scheduler from the root docker-compose.yml..."
    Invoke-RxoCompose -CommandArgs @('up', '-d', 'rxo-export') | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "The session was reset, but the RXO scheduler could not be restarted. Run START-RXO-INTEGRATION.cmd."
    }
}

Write-Host "[OK] RXO browser/session state reset."
Write-Host "Credentials and exported data were preserved."
