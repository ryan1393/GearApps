[CmdletBinding()]
param(
    [string]$OldEnv,
    [string]$Server,
    [string]$AppFolder
)

# Compatibility entry point: perform the update on Linux through SCP and SSH.
$ErrorActionPreference = 'Stop'
$DeployScript = Join-Path $PSScriptRoot 'DEPLOY-TRUCKLOG-LINUX.ps1'
if (-not (Test-Path -LiteralPath $DeployScript -PathType Leaf)) {
    Write-Error 'Extract the complete Linux deployment ZIP; DEPLOY-TRUCKLOG-LINUX.ps1 is missing.'
    exit 1
}
& $DeployScript @PSBoundParameters
exit $LASTEXITCODE
