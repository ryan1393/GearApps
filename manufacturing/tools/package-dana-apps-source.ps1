param(
    [string]$OutputDirectory = "",
    [string]$ArchivePrefix = ""
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) {
    throw "Could not locate repository root above tools directory."
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = $Root
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$ProjectName = Split-Path $Root -Leaf
if ([string]::IsNullOrWhiteSpace($ArchivePrefix)) {
    $ArchivePrefix = $ProjectName
}

$Stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$Zip = Join-Path $OutputDirectory "$ArchivePrefix-FULL-SOURCE-$Stamp.zip"

# Keep the staging root deliberately short. Windows PowerShell 5.1 / .NET Framework
# can still encounter legacy path-length edge cases when auditing deep source trees.
$Stage = Join-Path $env:TEMP ("DAP-" + [guid]::NewGuid().ToString('N').Substring(0,8))
$StageProject = Join-Path $Stage $ProjectName

$ExcludedRootDirectories = @(
    'node_modules',
    '.nx',
    '.git',
    'dist',
    'build',
    'coverage',
    '_patch_backups',
    '_archive',
    '.angular',
    '.cache',
    'runtime-data'
)

# IMPORTANT: these are absolute root paths, not bare directory names.
# A bare Robocopy /XD value such as "build" also excludes legitimate nested
# source directories named build (for example Cutter Builder pages/build).
$ExcludedRootPaths = @(
    $ExcludedRootDirectories | ForEach-Object { Join-Path $Root $_ }
)

$SafeEnvTemplateNames = @(
    '.env.example',
    '.env.sample',
    '.env.template'
)

function Test-BlockedPackageFile {
    param([System.IO.FileInfo]$File)

    $name = $File.Name.ToLowerInvariant()
    $full = $File.FullName.ToLowerInvariant()

    if ($name -eq '.env') { return $true }
    if ($name.StartsWith('.env.') -and ($SafeEnvTemplateNames -notcontains $name)) { return $true }
    if ($name -eq '.npmrc') { return $true }

    if ($name -match '^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$') { return $true }
    if ($name -match '^(credentials|secrets?|service-account).*\.json$') { return $true }
    if ($name -match '^(rxo-browser-state|storage-state|auth-state|cookies?).*\.json$') { return $true }

    if ($File.Extension.ToLowerInvariant() -in @('.pem','.key','.pfx','.p12','.jks','.keystore','.kdbx')) {
        return $true
    }

    if ($File.Extension.ToLowerInvariant() -in @('.sqlite','.sqlite3','.db')) {
        return $true
    }

    if ($full -match '[\\/](secrets?|credentials?)[\\/]') { return $true }

    return $false
}

function Get-RelativePackagePath {
    param(
        [string]$BaseRoot,
        [string]$FullName
    )

    $base = $BaseRoot.TrimEnd('\\','/')
    if (-not $FullName.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside expected root: $FullName"
    }

    return $FullName.Substring($base.Length).TrimStart('\\','/').Replace('\\','/')
}

function Get-SourceInventory {
    param([string]$BaseRoot)

    $items = New-Object System.Collections.Generic.List[string]

    foreach ($tree in @('apps','libs','tools')) {
        $treePath = Join-Path $BaseRoot $tree
        if (-not (Test-Path -LiteralPath $treePath)) { continue }

        foreach ($file in @(Get-ChildItem -LiteralPath $treePath -Recurse -Force -File -ErrorAction Stop)) {
            if ($file.Extension.ToLowerInvariant() -in @('.zip','.log')) { continue }
            if (Test-BlockedPackageFile $file) { continue }
            $items.Add((Get-RelativePackagePath -BaseRoot $BaseRoot -FullName $file.FullName))
        }
    }

    return @($items | Sort-Object -Unique)
}

function Assert-StagedSourceCompleteness {
    $live = @(Get-SourceInventory -BaseRoot $Root)
    $staged = @(Get-SourceInventory -BaseRoot $StageProject)
    $stageSet = @{}
    foreach ($rel in $staged) { $stageSet[$rel.ToLowerInvariant()] = $true }

    $missing = @(
        foreach ($rel in $live) {
            if (-not $stageSet.ContainsKey($rel.ToLowerInvariant())) { $rel }
        }
    )

    if ($missing.Count -gt 0) {
        $preview = ($missing | Select-Object -First 40) -join [Environment]::NewLine
        throw "Staged package is missing live source files. An exclusion rule likely matched a legitimate nested source directory:`n$preview"
    }

    foreach ($protected in @(
        'libs/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.ts',
        'libs/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.html'
    )) {
        if ((Test-Path -LiteralPath (Join-Path $Root $protected)) -and
            -not (Test-Path -LiteralPath (Join-Path $StageProject $protected))) {
            throw "Protected Cutter Builder source was omitted from staging: $protected"
        }
    }

    Write-Host "[PASS] Staged source completeness verified: $($live.Count) live source files preserved." -ForegroundColor Green
}

function Get-StagedPackageFiles {
    try {
        return @(
            Get-ChildItem -LiteralPath $StageProject -Recurse -Force -File -ErrorAction Stop
        )
    }
    catch {
        throw "Staging audit could not enumerate a copied path after archived trees and junctions were excluded. Remaining path may be unreadable or too long: $($_.Exception.Message)"
    }
}

try {
    New-Item -ItemType Directory -Path $StageProject -Force | Out-Null

    $robocopyArgs = @(
        $Root,
        $StageProject,
        '/E',
        '/R:1',
        '/W:1',
        '/NFL',
        '/NDL',
        '/NJH',
        '/NJS',
        '/NP',
        '/XJ',
        '/XD'
    ) + $ExcludedRootPaths + @(
        '/XF',
        '*.zip',
        '*.log'
    )

    & robocopy.exe @robocopyArgs | Out-Null
    $rc = $LASTEXITCODE
    if ($rc -ge 8) {
        throw "robocopy failed with exit code $rc"
    }

    # Robocopy codes 0..7 are successful. Normalize native-command state so
    # callers do not mistake the normal 'files copied' code 1 for failure.
    $global:LASTEXITCODE = 0

    $blocked = @(
        Get-StagedPackageFiles |
            Where-Object { Test-BlockedPackageFile $_ }
    )

    foreach ($file in $blocked) {
        Remove-Item -LiteralPath $file.FullName -Force
    }

    $remainingBlocked = @(
        Get-StagedPackageFiles |
            Where-Object { Test-BlockedPackageFile $_ }
    )

    if ($remainingBlocked.Count -gt 0) {
        $names = ($remainingBlocked | ForEach-Object { $_.FullName }) -join [Environment]::NewLine
        throw "Blocked sensitive/package-local files remain in staging:`n$names"
    }

    Assert-StagedSourceCompleteness

    if (Test-Path -LiteralPath $Zip) {
        Remove-Item -LiteralPath $Zip -Force
    }

    Compress-Archive -LiteralPath $StageProject -DestinationPath $Zip -CompressionLevel Optimal -Force

    if (-not (Test-Path -LiteralPath $Zip)) {
        throw "ZIP was not created."
    }

    $info = Get-Item -LiteralPath $Zip
    Write-Host ""
    Write-Host "[PASS] Safe source package created." -ForegroundColor Green
    Write-Host "ZIP:  $($info.FullName)" -ForegroundColor Green
    Write-Host ("Size: {0:N2} MB" -f ($info.Length / 1MB)) -ForegroundColor Green
    Write-Host "Excluded runtime/cache/backups/_archive/junctions plus .env, .npmrc, private keys, credentials, browser/auth state, and local DB files."
}
finally {
    if (Test-Path -LiteralPath $Stage) {
        Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
