$ErrorActionPreference = 'Stop'
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $WorkspaceRoot

function Invoke-NativeChecked {
    param([string]$Label,[scriptblock]$Command)
    Write-Host $Label -ForegroundColor Yellow
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

Write-Host "=== MeshForge validation ===" -ForegroundColor Cyan
$env:NX_DAEMON = 'false'
$env:NX_ISOLATE_PLUGINS = 'false'

# Windows/Nx hardening: validation gets isolated Nx workspace state instead of
# deleting the repo's shared .nx\workspace-data tree. VS Code/Nx processes may
# legitimately hold that directory open, which previously caused EPERM and
# aborted an otherwise-good release validation.
$NxValidationRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("meshforge-nx-validation-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))
$env:NX_WORKSPACE_DATA_DIRECTORY = Join-Path $NxValidationRoot 'workspace-data'
$env:NX_CACHE_DIRECTORY = Join-Path $NxValidationRoot 'cache'
New-Item -ItemType Directory -Path $env:NX_WORKSPACE_DATA_DIRECTORY -Force | Out-Null
New-Item -ItemType Directory -Path $env:NX_CACHE_DIRECTORY -Force | Out-Null
Write-Host "[NX] Isolated validation workspace: $NxValidationRoot" -ForegroundColor DarkGray

try {
    Invoke-NativeChecked '[1/4] Building server...' { npx nx build meshforge-server }
    Invoke-NativeChecked '[2/4] Building Blade Tracking...' { npx nx build blade-tracking }
    Invoke-NativeChecked '[3/4] Building Cutter Builder...' { npx nx build cutter-builder }
    Invoke-NativeChecked '[4/4] Building Green Shed...' { npx nx build greenshed }

    Write-Host ""
    Write-Host '[PASS] All four MeshForge projects built successfully using isolated Nx validation state.' -ForegroundColor Green
    exit 0
}
finally {
    Remove-Item -LiteralPath $NxValidationRoot -Recurse -Force -ErrorAction SilentlyContinue
}
