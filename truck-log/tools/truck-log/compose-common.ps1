Set-StrictMode -Version 2.0

$script:TruckLogComposeMode = $null
$script:TruckLogComposeVersion = $null
$script:TruckLogRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# Fixed names used by docker-compose.yml (test-compose.mjs keeps these lists in sync).
$script:TruckLogContainerNames = @('truck-log-postgres','truck-log-server','truck-log-web','truck-log-rxo-export','truck-log-rxo-browser','truck-log-rxo-expedite-scheduler')
$script:TruckLogVolumeNames = @('truck-log-postgres-data','truck-log-documents','truck-log-rxo-import','truck-log-rxo-data','truck-log-rxo-state','truck-log-rxo-credentials','truck-log-rxo-expedite-data','truck-log-rxo-expedite-state')

function Get-TruckLogRelease {
    return (Get-Content -LiteralPath (Join-Path $script:TruckLogRoot 'VERSION') -Raw).Trim()
}

function Get-ComposeProjectLabel([string]$Labels) {
    # Docker prints labels as "k=v,k=v". Read them from output rather than passing a quoted
    # Go template, which Windows PowerShell 5.1 mangles when calling docker.exe.
    foreach ($pair in ($Labels -split ',')) {
        if ($pair -like 'com.docker.compose.project=*') { return $pair.Substring('com.docker.compose.project='.Length) }
    }
    return ''
}

<#
  Containers and volumes that use Truck Log's fixed names but belong to another Docker
  Compose project, such as an older test install. Compose cannot start next to them:
  the containers clash by name and the volumes hold another install's data.
#>
function Get-ForeignTruckLogResources {
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($line in @(& { $ErrorActionPreference = 'Continue'; & docker ps -a --filter 'name=truck-log' --format '{{.Names}}|{{.Labels}}' 2>$null })) {
        $name, $labels = ([string]$line) -split '\|', 2
        if ($script:TruckLogContainerNames -notcontains $name) { continue }
        $project = Get-ComposeProjectLabel $labels
        if ($project -ne 'truck-log') { $found.Add([pscustomobject]@{ Kind = 'container'; Name = $name; Project = $(if ($project) { $project } else { 'none' }) }) }
    }
    foreach ($line in @(& { $ErrorActionPreference = 'Continue'; & docker volume ls --filter 'name=truck-log' --format '{{.Name}}|{{.Labels}}' 2>$null })) {
        $name, $labels = ([string]$line) -split '\|', 2
        if ($script:TruckLogVolumeNames -notcontains $name) { continue }
        $project = Get-ComposeProjectLabel $labels
        # Unlabelled volumes are normal: the credential setup tools create some of them.
        if ($project -and $project -ne 'truck-log') { $found.Add([pscustomobject]@{ Kind = 'volume'; Name = $name; Project = $project }) }
    }
    return ,$found
}

function Assert-NoForeignTruckLogResources {
    $found = Get-ForeignTruckLogResources
    if ($found.Count -eq 0) { return }
    Write-Host ''
    Write-Host '[STOP] An older Truck Log install is still on this Docker host:' -ForegroundColor Yellow
    foreach ($item in $found) { Write-Host ("  {0,-9} {1,-36} (project {2})" -f $item.Kind, $item.Name, $item.Project) }
    throw @"
These use the same names as Truck Log $(Get-TruckLogRelease), so it cannot start next to them.
If that install holds only test data, run REMOVE-OLD-TRUCK-LOG-INSTALL.cmd, then run this again.
If you need its data, stop here and contact the Truck Log maintainer.
"@
}

function Get-TruckLogComposeMajor([string]$VersionText) {
    $text = if ($null -eq $VersionText) { '' } else { $VersionText.Trim() }
    if ($text -match '^(?:Docker Compose version\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z._-]+)?$') {
        return [int]$Matches[1]
    }
    return $null
}

function Resolve-TruckLogCompose {
    & { $ErrorActionPreference = 'Continue'; & docker compose version --short *> $null }
    if ($LASTEXITCODE -eq 0) {
        $version = (& docker compose version --short).Trim()
        $major = Get-TruckLogComposeMajor $version
        if ($major -ge 2) {
            $script:TruckLogComposeMode = 'plugin'
            $script:TruckLogComposeVersion = $version
            return
        }
    }

    $standalone = Get-Command docker-compose -ErrorAction SilentlyContinue
    if ($standalone) {
        & { $ErrorActionPreference = 'Continue'; & docker-compose version --short *> $null }
        if ($LASTEXITCODE -eq 0) {
            $version = (& docker-compose version --short).Trim()
            $major = Get-TruckLogComposeMajor $version
            if ($major -ge 2) {
                $script:TruckLogComposeMode = 'standalone'
                $script:TruckLogComposeVersion = $version
                return
            }
        }
    }
    throw 'Docker Compose v2+ was not found. Install the Docker Compose v2 plugin (preferred) or a v2 standalone frontend.'
}

function Invoke-TruckLogCompose {
    param(
        [Parameter(Mandatory=$true)][string[]]$CommandArgs,
        [switch]$AllowFailure
    )
    if (-not $script:TruckLogComposeMode) { Resolve-TruckLogCompose }
    # The image tag always comes from VERSION. A TRUCK_LOG_RELEASE left in the Windows
    # environment by an older install would otherwise override .env and build old tags.
    $env:TRUCK_LOG_RELEASE = Get-TruckLogRelease
    if ($script:TruckLogComposeMode -eq 'plugin') { & docker compose -p truck-log @CommandArgs }
    else { & docker-compose -p truck-log @CommandArgs }
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "Docker Compose command failed with exit code ${code}: $($CommandArgs -join ' ')"
    }
    return $code
}
