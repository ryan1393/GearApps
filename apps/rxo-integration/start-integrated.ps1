$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
. "$PSScriptRoot\remote-docker.ps1"

Require-RemoteDocker

Write-Host ""
Write-Host "============================================================"
Write-Host " TRUCK LOG / RXO INTEGRATION - START"
Write-Host "============================================================"
Write-Host ""
Write-Host "Nx project: rxo-integration"
Write-Host "Truck Log RXO release:"
Write-Host ""

# Do not let an older standalone recurring service and the integrated Nx copy
# both run the same 30-minute RXO exporter against the shared named volumes.
#
# `docker compose run` one-off/test containers are deliberately NOT stopped
# (the exporter lock keeps them from running concurrently with the scheduler).
#
# Only request ID + Name from docker ps. The previous
# nested Go-template Label expression was vulnerable to PowerShell quote
# stripping and reached Docker as `.Label com.docker...`, which Docker
# parsed as a nonexistent template function named `com`.
$RecurringRows = @(
    & { $ErrorActionPreference = 'Continue'; & docker ps `
        --filter "label=com.docker.compose.project=truck-log" `
        --filter "label=com.docker.compose.service=rxo-export" `
        --filter "label=com.docker.compose.oneoff=False" `
        --format "{{.ID}}|{{.Names}}" `
        2>&1 }
)

if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect existing recurring RXO exporter containers."
}

$RecurringContainers = @()

foreach ($Row in $RecurringRows) {
    $Text = $Row.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($Text)) {
        continue
    }

    $Parts = $Text -split "\|", 3
    if ($Parts.Count -lt 2) {
        continue
    }

    $RecurringContainers += [pscustomobject]@{
        Id = $Parts[0].Trim()
        Name = $Parts[1].Trim()
        Project = ""
    }
}

if ($RecurringContainers.Count -gt 0) {
    Write-Host "Stopping existing recurring RXO exporter service container(s) before starting the integrated copy:" -ForegroundColor Yellow

    foreach ($Container in $RecurringContainers) {
        Write-Host (
            "  $($Container.Name)" +
            $(if ($Container.Project) { "  compose-project=$($Container.Project)" } else { "" })
        ) -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Only recurring Compose service containers labeled rxo-export are affected." -ForegroundColor Yellow

    foreach ($Container in $RecurringContainers) {
        $Stopped = Invoke-NativeRetry `
            -Description "Stop existing recurring RXO exporter $($Container.Name)" `
            -MaxAttempts 4 `
            -InitialDelaySeconds 4 `
            -Command {
                & docker stop $Container.Id | Out-Null
            }

        if (-not $Stopped) {
            throw "Could not stop recurring RXO exporter '$($Container.Name)'. Integrated exporter was NOT started."
        }
    }
}

& "$PSScriptRoot\start.ps1"

Write-Host ""
Write-Host "[OK] Truck Log Nx RXO integration is the active recurring exporter." -ForegroundColor Green
