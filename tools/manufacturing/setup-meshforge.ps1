[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$CleanInstall,
    [switch]$NoSharedCache,
    [switch]$SkipNxReset,
    [switch]$SkipDataValidation,
    [switch]$RunFreshImportPreflight,
    [switch]$RunTests
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $ProjectRoot

$env:CYPRESS_INSTALL_BINARY = '0'
$env:NX_DAEMON = 'false'
$env:NX_ISOLATE_PLUGINS = 'false'
$env:NX_CACHE_PROJECT_GRAPH = 'false'

Write-Host ''
Write-Host 'Unblocking downloaded MeshForge files...' -ForegroundColor Yellow
try {
    Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -ErrorAction Stop |
        Unblock-File -ErrorAction Stop
    Write-Host '[PASS] MeshForge files unblocked.' -ForegroundColor Green
} catch {
    Write-Warning "Could not unblock every project file: $($_.Exception.Message)"
    Write-Warning 'Continuing because this launcher already uses ExecutionPolicy Bypass where required.'
}



function Invoke-Checked {
    param(
        [Parameter(Mandatory=$true)][string]$Label,
        [Parameter(Mandatory=$true)][scriptblock]$Command
    )

    Write-Host ''
    Write-Host $Label -ForegroundColor Yellow
    & $Command

    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ' MeshForge - Laptop Setup' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js was not found in PATH. Install Node.js before running MeshForge setup.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found in PATH. Install npm/Node.js before running MeshForge setup.'
}

$nodeVersion = (& node --version).Trim()
$npmVersion = (& npm --version).Trim()

Write-Host "[PASS] Node.js detected: $nodeVersion" -ForegroundColor Green
Write-Host "[PASS] npm detected:     $npmVersion" -ForegroundColor Green

if ($nodeVersion -ne 'v24.22.1' -or $npmVersion -ne '11.9.0') {
    throw "This workspace requires Node.js 24.22.1 and npm 11.9.0. Detected $nodeVersion / $npmVersion."
}
Write-Host '[PASS] Shared Node.js/npm versions match the root workspace.' -ForegroundColor Green

if (-not (Test-Path (Join-Path $ProjectRoot 'package.json'))) {
    throw 'package.json was not found. Run this script from the extracted MeshForge project.'
}

function Test-NxInstallIntegrity {
    $worker = Join-Path $ProjectRoot 'node_modules\nx\dist\src\project-graph\plugins\isolation\plugin-worker.js'
    $nxPackage = Join-Path $ProjectRoot 'node_modules\nx\package.json'

    if (-not (Test-Path $worker) -or -not (Test-Path $nxPackage)) {
        Write-Warning 'Nx package or plugin worker is missing.'
        return $false
    }

    # First prove the exact worker file that previously failed is valid JavaScript.
    & node --check $worker
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Nx plugin-worker syntax check failed with exit code $LASTEXITCODE."
        return $false
    }

    # Then prove the installed Nx CLI can actually execute. This is a stronger
    # runtime check than comparing package-lock JSON internals.
    $oldDaemon = $env:NX_DAEMON
    $oldIsolation = $env:NX_ISOLATE_PLUGINS
    try {
        $env:NX_DAEMON = 'false'
        $env:NX_ISOLATE_PLUGINS = 'false'

        $nxVersionOutput = (& npx --no-install nx --version 2>&1 | Out-String).Trim()
        $nxExit = $LASTEXITCODE
        if ($nxExit -ne 0 -or -not $nxVersionOutput) {
            Write-Warning "Nx CLI execution failed with exit code $nxExit. Output: $nxVersionOutput"
            return $false
        }

        try {
            $installedNx = (Get-Content $nxPackage -Raw | ConvertFrom-Json).version
        } catch {
            Write-Warning "Could not read installed Nx package version: $($_.Exception.Message)"
            return $false
        }

        if ($nxVersionOutput -notmatch [regex]::Escape([string]$installedNx)) {
            Write-Warning "Nx CLI version output '$nxVersionOutput' did not match installed package version '$installedNx'."
            return $false
        }

        Write-Host "[PASS] Nx worker syntax valid; Nx CLI reports $nxVersionOutput." -ForegroundColor Green
        return $true
    } finally {
        $env:NX_DAEMON = $oldDaemon
        $env:NX_ISOLATE_PLUGINS = $oldIsolation
    }
}

function Remove-DirectoryRobust {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [int]$Attempts = 8
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            # Give npm/husky/AV/indexing handles a chance to close before retries.
            if ($attempt -gt 1) {
                Start-Sleep -Milliseconds (500 * $attempt)
            }

            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            if (-not (Test-Path -LiteralPath $Path)) {
                return
            }
        } catch {
            Write-Warning "Delete attempt $attempt/$Attempts failed for '$Path': $($_.Exception.Message)"
        }

        # Windows cmd/rmdir is often able to finish trees that PowerShell
        # Remove-Item partially removed.
        try {
            & cmd.exe /d /c "rd /s /q `"$Path`"" 2>$null
        } catch {
            # Retry loop handles any remaining lock.
        }

        if (-not (Test-Path -LiteralPath $Path)) {
            return
        }
    }

    throw @"
Could not remove '$Path' after $Attempts attempts because Windows still has a file or folder open.
Close any terminals/Explorer windows that are inside this MeshForge folder, then run commands\SETUP-MESHFORGE.cmd again.
The setup script did not continue with a partial dependency tree.
"@
}

function Get-DependencyCacheKey {
    $lockFile = Join-Path $ProjectRoot 'package-lock.json'
    if (-not (Test-Path -LiteralPath $lockFile -PathType Leaf)) {
        throw 'package-lock.json was not found. MeshForge requires the lock file for deterministic setup.'
    }

    $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $nodeAbi = (& node -p "process.versions.modules").Trim()
    $nodePlatform = (& node -p "process.platform").Trim()
    $nodeArch = (& node -p "process.arch").Trim()
    return "$lockHash-abi$nodeAbi-$nodePlatform-$nodeArch"
}

function Get-DependencyCachePath {
    $cacheBase = $env:GEAR_APPS_DEP_CACHE
    if (-not $cacheBase) {
        if ($env:LOCALAPPDATA) {
            $cacheBase = Join-Path $env:LOCALAPPDATA 'GearApps\dependency-cache'
        } else {
            $cacheBase = Join-Path $env:USERPROFILE '.meshforge\dependency-cache'
        }
    }
    return (Join-Path $cacheBase (Get-DependencyCacheKey))
}

function Remove-ProjectNodeModules {
    $nodeModulesPath = Join-Path $ProjectRoot 'node_modules'
    if (-not (Test-Path -LiteralPath $nodeModulesPath)) {
        return
    }

    $item = Get-Item -LiteralPath $nodeModulesPath -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        # Remove only the junction itself, never its shared-cache target.
        & cmd.exe /d /c "rd /q `"$nodeModulesPath`"" 2>$null
        if ($LASTEXITCODE -ne 0 -and (Test-Path -LiteralPath $nodeModulesPath)) {
            throw "Could not remove node_modules junction '$nodeModulesPath'."
        }
        return
    }

    Remove-DirectoryRobust -Path $nodeModulesPath
}

function New-NodeModulesJunction {
    param([Parameter(Mandatory=$true)][string]$TargetNodeModules)

    if (-not (Test-Path -LiteralPath $TargetNodeModules -PathType Container)) {
        throw "Shared dependency cache is missing: $TargetNodeModules"
    }

    Remove-ProjectNodeModules
    $projectNodeModules = Join-Path $ProjectRoot 'node_modules'
    & cmd.exe /d /c "mklink /J `"$projectNodeModules`" `"$TargetNodeModules`" >nul"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $projectNodeModules)) {
        throw "Could not create node_modules junction to '$TargetNodeModules'."
    }
}

function Try-UseSharedDependencyCache {
    if ($NoSharedCache) {
        return $false
    }

    $cachePath = Get-DependencyCachePath
    $cachedNodeModules = Join-Path $cachePath 'node_modules'
    if (-not (Test-Path -LiteralPath $cachedNodeModules -PathType Container)) {
        return $false
    }

    Write-Host ''
    Write-Host "FAST SETUP: reusing dependency cache $cachePath" -ForegroundColor Cyan
    try {
        New-NodeModulesJunction -TargetNodeModules $cachedNodeModules
        if (Test-NxInstallIntegrity) {
            Write-Host '[PASS] FAST dependency cache is valid. npm install skipped.' -ForegroundColor Green
            return $true
        }
    } catch {
        Write-Warning "Shared dependency cache could not be used: $($_.Exception.Message)"
    }

    # The cache key already includes package-lock hash + Node ABI/platform/arch.
    # If it still fails integrity, quarantine it and rebuild once.
    Remove-ProjectNodeModules
    if (Test-Path -LiteralPath $cachePath) {
        Write-Warning 'Removing invalid MeshForge dependency cache.'
        Remove-DirectoryRobust -Path $cachePath -Attempts 10
    }
    return $false
}

function Publish-SharedDependencyCache {
    if ($NoSharedCache) {
        return
    }

    $projectNodeModules = Join-Path $ProjectRoot 'node_modules'
    if (-not (Test-Path -LiteralPath $projectNodeModules -PathType Container)) {
        return
    }

    $cachePath = Get-DependencyCachePath
    $cachedNodeModules = Join-Path $cachePath 'node_modules'
    try {
        if (Test-Path -LiteralPath $cachePath) {
            Remove-DirectoryRobust -Path $cachePath -Attempts 10
        }
        New-Item -ItemType Directory -Path $cachePath -Force | Out-Null

        Write-Host "Caching this known-good dependency tree for future MeshForge folders..." -ForegroundColor Cyan
        Move-Item -LiteralPath $projectNodeModules -Destination $cachedNodeModules -Force
        Set-Content -LiteralPath (Join-Path $cachePath 'cache-key.txt') -Value (Get-DependencyCacheKey) -Encoding UTF8
        New-NodeModulesJunction -TargetNodeModules $cachedNodeModules
        Write-Host '[PASS] Shared dependency cache created. Future fresh ZIPs with this lock file can skip npm ci.' -ForegroundColor Green
    } catch {
        Write-Warning "Could not publish shared dependency cache: $($_.Exception.Message)"
        # If Move-Item succeeded before a later cache step failed, reconnect to it.
        if (-not (Test-Path -LiteralPath $projectNodeModules) -and (Test-Path -LiteralPath $cachedNodeModules)) {
            New-NodeModulesJunction -TargetNodeModules $cachedNodeModules
        }
    }
}

function Install-CleanDependencies {
    Write-Host ''
    Write-Host 'CLEAN SETUP: installing exact dependencies from package-lock.json.' -ForegroundColor Yellow
    Write-Host 'npm will prefer its local download cache and will not run audit/funding checks.' -ForegroundColor DarkGray

    Remove-ProjectNodeModules
    $nxCache = Join-Path $ProjectRoot '.nx'
    if (Test-Path -LiteralPath $nxCache) {
        Remove-DirectoryRobust -Path $nxCache
    }

    & npm ci --prefer-offline --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Fast npm ci failed. Verifying npm cache and retrying once.'
        & npm cache verify
        if ($LASTEXITCODE -ne 0) {
            throw 'npm cache verify failed during dependency recovery.'
        }
        Remove-ProjectNodeModules
        & npm ci --prefer-offline --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw 'npm ci failed after cache verification.'
        }
    }

    if (-not (Test-NxInstallIntegrity)) {
        Write-Warning 'Nx install integrity failed. Performing one full cache-clear recovery install.'
        Start-Sleep -Seconds 2
        Remove-ProjectNodeModules
        & npm cache clean --force
        if ($LASTEXITCODE -ne 0) {
            throw 'npm cache clean failed while recovering the Nx installation.'
        }
        & npm ci --prefer-offline --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw 'npm ci failed while recovering the Nx installation.'
        }
        if (-not (Test-NxInstallIntegrity)) {
            throw 'Nx is still invalid after a clean reinstall. Do not start MeshForge from this folder.'
        }
    }

    Write-Host '[PASS] Clean dependency install completed and Nx integrity passed.' -ForegroundColor Green
}

$dependenciesReady = $false

if (-not $CleanInstall -and (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))) {
    Write-Host ''
    Write-Host 'FAST SETUP: checking existing node_modules...' -ForegroundColor Cyan
    if (Test-NxInstallIntegrity) {
        $dependenciesReady = $true
        Write-Host '[PASS] Existing dependencies are valid. npm install skipped.' -ForegroundColor Green
    } else {
        Write-Warning 'Existing node_modules failed integrity and will not be reused.'
        Remove-ProjectNodeModules
    }
}

if (-not $dependenciesReady -and -not $CleanInstall) {
    $dependenciesReady = Try-UseSharedDependencyCache
}

if ($SkipInstall) {
    if (-not $dependenciesReady) {
        throw '-SkipInstall was supplied, but neither local nor shared cached dependencies are valid.'
    }
} elseif (-not $dependenciesReady) {
    if ($CleanInstall -and -not $NoSharedCache) {
        $cachePath = Get-DependencyCachePath
        if (Test-Path -LiteralPath $cachePath) {
            Write-Host 'CleanInstall requested: removing matching shared dependency cache first.' -ForegroundColor Yellow
            Remove-DirectoryRobust -Path $cachePath -Attempts 10
        }
    }
    Install-CleanDependencies
    Publish-SharedDependencyCache
    $dependenciesReady = $true
}

if (-not $SkipNxReset) {
    Invoke-Checked 'Resetting Nx state/cache...' {
        npx nx reset
    }
} else {
    Write-Host ''
    Write-Host '[SKIP] npx nx reset' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Checking Nx workspace...' -ForegroundColor Yellow
$projects = & npx nx show projects
if ($LASTEXITCODE -ne 0) {
    throw "Nx workspace check failed with exit code $LASTEXITCODE."
}

$requiredProjects = @(
    'gear-app-server',
    'blade-tracking',
    'cutter-builder',
    'greenshed'
)

$projectNames = @($projects | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($project in $requiredProjects) {
    if ($projectNames -notcontains $project) {
        throw "Required Nx project '$project' was not found."
    }
    Write-Host "[PASS] Nx project found: $project" -ForegroundColor Green
}

if (-not $SkipDataValidation) {
    Invoke-Checked 'Validating Excel-derived base/reference data...' {
        npm run validate:base-data
    }

    Invoke-Checked 'Validating fresh SQL Server + Excel import contract...' {
        npm run test:data-import
    }
} else {
    Write-Host ''
    Write-Host '[SKIP] Base-data and fresh-import contract validation' -ForegroundColor DarkGray
}

if ($RunFreshImportPreflight) {
    Invoke-Checked 'Running fresh SQL Server + Excel import PRE-FLIGHT (read-only source / no PostgreSQL writes)...' {
        npm run import:all-fresh
    }
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Green
Write-Host ' MeshForge setup completed successfully.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'show-meshforge-commands.ps1') -Compact

if ($RunTests) {
    Write-Host 'Running MeshForge test suite...' -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'run-all-tests.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "MeshForge test suite failed with exit code $LASTEXITCODE."
    }
}

