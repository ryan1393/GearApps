# Compatibility entry point: package the complete, single GearApps workspace.
param(
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Packager = Join-Path $WorkspaceRoot 'tools/package-release.mjs'
if (-not (Test-Path -LiteralPath $Packager -PathType Leaf)) {
    throw "Root release packager is missing: $Packager"
}
$Node = Get-Command node -ErrorAction Stop
$NodeArgs = @($Packager)
if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $AbsoluteOutput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
    $NodeArgs += @('--output-dir', $AbsoluteOutput)
}
Push-Location $WorkspaceRoot
try {
    & $Node.Source @NodeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "GearApps release packaging failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
