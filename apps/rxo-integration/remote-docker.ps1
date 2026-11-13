Set-StrictMode -Version Latest

# Every RXO Compose call uses the ONE root docker-compose.yml (project truck-log)
# through Compose v2, resolved by tools/truck-log/compose-common.ps1.
$script:RxoWorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $script:RxoWorkspaceRoot 'tools\truck-log\compose-common.ps1')
Set-StrictMode -Version Latest

function Invoke-RxoCompose {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$CommandArgs
    )

    if (-not $script:TruckLogComposeMode) { Resolve-TruckLogCompose }

    # Compose writes progress to stderr. Merge it here, with a non-terminating
    # preference, so Windows PowerShell 5.1 does not turn progress lines into
    # NativeCommandError. $LASTEXITCODE stays the real Compose exit code.
    $ErrorActionPreference = 'Continue'
    Push-Location $script:RxoWorkspaceRoot
    try {
        if ($script:TruckLogComposeMode -eq 'plugin') {
            & { $ErrorActionPreference = 'Continue'; & docker compose -p truck-log @CommandArgs 2>&1 }
        }
        else {
            & { $ErrorActionPreference = 'Continue'; & docker-compose -p truck-log @CommandArgs 2>&1 }
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-NativeRetry {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,

        [Parameter(Mandatory = $true)]
        [string]$Description,

        [int]$MaxAttempts = 5,

        [int]$InitialDelaySeconds = 5
    )

    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
        Write-Host ""
        Write-Host "[DOCKER] $Description - attempt $Attempt/$MaxAttempts"

        # Native/Compose stdout MUST NOT leak into this function's success
        # output stream. Callers assign this function to a Boolean variable.
        # If native stdout leaks, PowerShell returns an array containing logs
        # plus $true/$false and later comparisons become invalid.
        & { $ErrorActionPreference = 'Continue'; & $Command 2>&1 } |
            ForEach-Object {
                Write-Host $_
            }

        $ExitCode = $LASTEXITCODE

        if ($ExitCode -eq 0) {
            return $true
        }

        if ($Attempt -lt $MaxAttempts) {
            $Delay = [Math]::Min(
                30,
                $InitialDelaySeconds * $Attempt
            )

            Write-Warning (
                "$Description failed with exit code $ExitCode. " +
                "Remote Docker/SSH may have disconnected. " +
                "Retrying in $Delay second(s)..."
            )

            Start-Sleep -Seconds $Delay
        }
    }

    return $false
}

function Wait-RemoteDocker {
    param(
        [int]$MaxAttempts = 8
    )

    Write-Host ""
    Write-Host "Checking remote Docker engine..."

    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
        $Output = @(
            & { $ErrorActionPreference = 'Continue'; & docker version `
                --format "{{.Server.Version}}" `
                2>&1 }
        )

        $ExitCode = $LASTEXITCODE

        if ($ExitCode -eq 0) {
            $ServerVersion = (
                $Output |
                Select-Object -Last 1
            ).ToString().Trim()

            Write-Host (
                "[OK] Remote Docker engine is responding" +
                $(if ($ServerVersion) { " - server $ServerVersion" } else { "" }) +
                "."
            )

            return $true
        }

        $Summary = (
            $Output |
            Out-String
        ).Trim()

        if ($Summary.Length -gt 500) {
            $Summary = $Summary.Substring(0, 500)
        }

        Write-Warning (
            "Remote Docker check $Attempt/$MaxAttempts failed. " +
            "$Summary"
        )

        if ($Attempt -lt $MaxAttempts) {
            $Delay = [Math]::Min(
                30,
                5 * $Attempt
            )

            Write-Host (
                "[DOCKER] Waiting $Delay second(s) before reconnect..."
            )

            Start-Sleep -Seconds $Delay
        }
    }

    return $false
}

function Require-RemoteDocker {
    if (-not (Wait-RemoteDocker)) {
        throw (
            "REMOTE DOCKER UNAVAILABLE. " +
            "The Docker engine could not be reached after repeated retries. " +
            "No RXO login/export was started. Check the SSH/Docker host connection."
        )
    }
}

function Get-DockerVolumeNames {
    for ($Attempt = 1; $Attempt -le 5; $Attempt++) {
        $Output = @(
            & { $ErrorActionPreference = 'Continue'; & docker volume ls `
                --format "{{.Name}}" `
                2>&1 }
        )

        if ($LASTEXITCODE -eq 0) {
            return @(
                $Output |
                ForEach-Object {
                    $_.ToString().Trim()
                } |
                Where-Object {
                    $_
                }
            )
        }

        if ($Attempt -lt 5) {
            $Delay = 4 * $Attempt

            Write-Warning (
                "Could not list Docker volumes. " +
                "Retrying in $Delay second(s)..."
            )

            Start-Sleep -Seconds $Delay
        }
    }

    throw "Could not list Docker volumes after repeated remote-Docker retries."
}

function Ensure-DockerVolume {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $Names = @(
        Get-DockerVolumeNames
    )

    if ($Names -contains $Name) {
        return
    }

    $Created = Invoke-NativeRetry `
        -Description "Create Docker volume $Name" `
        -MaxAttempts 4 `
        -Command {
            & docker volume create $Name | Out-Null
        }

    if (-not $Created) {
        throw "Could not create Docker volume '$Name'."
    }
}

function Assert-DockerVolumeExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [string]$MissingMessage = ""
    )

    $Names = @(
        Get-DockerVolumeNames
    )

    if ($Names -notcontains $Name) {
        if ($MissingMessage) {
            throw $MissingMessage
        }

        throw "Required Docker volume '$Name' does not exist."
    }
}

function Invoke-ComposeBuildRetry {
    param(
        [string]$Service = "rxo-export"
    )

    Require-RemoteDocker

    $Built = Invoke-NativeRetry `
        -Description "Build RXO Docker image" `
        -MaxAttempts 5 `
        -InitialDelaySeconds 8 `
        -Command {
            Invoke-RxoCompose -CommandArgs @('build', $Service)
        }

    if (-not $Built) {
        throw (
            "DOCKER IMAGE BUILD COULD NOT COMPLETE AFTER RETRIES. " +
            "The remote Docker/SSH transport is still unstable. " +
            "No RXO export was started."
        )
    }
}

function Get-ContainerState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName
    )

    for ($Attempt = 1; $Attempt -le 6; $Attempt++) {
        $Output = @(
            & { $ErrorActionPreference = 'Continue'; & docker inspect `
                --format "{{.State.Status}}|{{.State.ExitCode}}" `
                $ContainerName `
                2>&1 }
        )

        if ($LASTEXITCODE -eq 0) {
            $Line = (
                $Output |
                Select-Object -Last 1
            ).ToString().Trim()

            if ($Line -match "^([^|]+)\|(-?\d+)$") {
                return [pscustomobject]@{
                    Exists   = $true
                    Status   = $Matches[1]
                    ExitCode = [int]$Matches[2]
                }
            }
        }

        if ($Attempt -lt 6) {
            Start-Sleep -Seconds (3 * $Attempt)
        }
    }

    return [pscustomobject]@{
        Exists   = $false
        Status   = "unknown"
        ExitCode = -1
    }
}

function Remove-ContainerBestEffort {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName
    )

    for ($Attempt = 1; $Attempt -le 4; $Attempt++) {
        & { $ErrorActionPreference = 'Continue'; & docker rm -f $ContainerName *> $null }

        if ($LASTEXITCODE -eq 0) {
            return
        }

        Start-Sleep -Seconds (2 * $Attempt)
    }

    Write-Warning (
        "Could not remove temporary container '$ContainerName'. " +
        "It can be removed later with: docker rm -f $ContainerName"
    )
}

function Invoke-ComposeRunRecoverable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName,

        [Parameter(Mandatory = $true)]
        [string[]]$ContainerCommand,

        [string]$Description = "RXO container job"
    )

    Require-RemoteDocker

    Write-Host ""
    Write-Host "[RXO] $Description"
    Write-Host (
        "[RXO] Recovery container name: $ContainerName"
    )
    Write-Host (
        "[RXO] If the SSH transport drops after startup, the script will " +
        "reconnect and inspect this exact container instead of blindly rerunning the job."
    )
    Write-Host ""

    # Do not use --rm here. If the Docker SSH session resets, the stopped/running
    # container is our recovery evidence.
    $ComposeArgs = @(
        "run",
        "-T",
        "--name", $ContainerName,
        "-e", "RXO_SYNC_ON_START=false",
        "rxo-export"
    ) + $ContainerCommand

    # Disable Compose TTY allocation (-T). On Windows + remote Docker over
    # SSH, pseudo-TTY probing can emit:
    #   failed to get console mode for stdout: The handle is invalid
    #
    # Also route all native output to Write-Host so the ONLY success-stream
    # value returned by this function is the integer exit code.
    Invoke-RxoCompose -CommandArgs $ComposeArgs |
        ForEach-Object {
            Write-Host $_
        }

    $AttachedExitCode = $LASTEXITCODE

    if ($AttachedExitCode -eq 0) {
        Remove-ContainerBestEffort -ContainerName $ContainerName
        return 0
    }

    Write-Warning (
        "$Description returned exit code $AttachedExitCode. " +
        "Checking whether this was only a remote Docker/SSH disconnect..."
    )

    Require-RemoteDocker

    $State = Get-ContainerState `
        -ContainerName $ContainerName

    if (-not $State.Exists) {
        throw (
            "$Description lost its Docker connection and the recovery container " +
            "could not be found. The job will NOT be rerun automatically because " +
            "that could duplicate an RXO export."
        )
    }

    while ($State.Status -eq "running") {
        Write-Host (
            "[DOCKER] Remote session recovered; RXO container is still running. " +
            "Waiting 15 seconds..."
        )

        Start-Sleep -Seconds 15

        Require-RemoteDocker

        $State = Get-ContainerState `
            -ContainerName $ContainerName

        if (-not $State.Exists) {
            throw (
                "The recovery container disappeared while waiting. " +
                "The RXO job will not be automatically rerun."
            )
        }
    }

    Write-Host ""
    Write-Host (
        "[DOCKER] Recovered container state: " +
        "$($State.Status), exit code $($State.ExitCode)"
    )

    Write-Host ""
    Write-Host "[DOCKER] Final recovered container log:"
    Write-Host "------------------------------------------------------------"

    & { $ErrorActionPreference = 'Continue'; & docker logs $ContainerName 2>&1 } |
        ForEach-Object {
            Write-Host $_
        }

    Write-Host "------------------------------------------------------------"

    $RecoveredExitCode = $State.ExitCode

    Remove-ContainerBestEffort `
        -ContainerName $ContainerName

    return $RecoveredExitCode
}
