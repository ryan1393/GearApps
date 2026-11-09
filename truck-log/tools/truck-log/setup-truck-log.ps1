[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host '  Truck Log - Nx Development Workspace Setup' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host 'This prepares source dependencies and builds only. It does not alter a database.'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found in PATH.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm was not found in PATH.' }
$nodeVersion = [version](node -p 'process.versions.node')
if (-not (($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 12) -or $nodeVersion.Major -eq 24)) {
    throw "Truck Log source development requires Node.js 22.12+ or Node.js 24. Current version: $nodeVersion"
}
Write-Host "[PASS] Node $(node -v); npm $(npm -v)" -ForegroundColor Green

Write-Host "`nValidating source layout before dependency installation..." -ForegroundColor Cyan
node tools\truck-log\validate-project-layout.mjs
if ($LASTEXITCODE -ne 0) { throw 'Nx project layout validation failed.' }

if (-not (Test-Path -LiteralPath 'package-lock.json')) { throw 'package-lock.json is missing.' }
Write-Host "`nInstalling exact locked workspace dependencies..." -ForegroundColor Cyan
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
if (-not (Test-Path -LiteralPath 'node_modules\.bin\nx.cmd')) { throw 'Nx was not installed correctly.' }
node tools\truck-log\validate-source.mjs
if ($LASTEXITCODE -ne 0) { throw 'Static source validation failed.' }
node tools\truck-log\verify-installed-dependencies.mjs
if ($LASTEXITCODE -ne 0) { throw 'Required dependency verification failed.' }

$env:NX_DAEMON = 'false'
$env:NX_ISOLATE_PLUGINS = 'false'
Write-Host "`nVerifying Nx project graph..." -ForegroundColor Cyan
$projectList = @(npx --no-install nx show projects)
if ($LASTEXITCODE -ne 0) { throw 'Nx project graph generation failed.' }
$requiredProjects = @('truck-log', 'truck-log-server', 'truck-log-shared-contracts', 'rxo-integration', 'rxo-expedite')
$missing = @($requiredProjects | Where-Object { $projectList -notcontains $_ })
if ($missing.Count -gt 0) { throw "Nx project graph is missing: $($missing -join ', ')" }
Write-Host "[PASS] Nx graph contains all $($requiredProjects.Count) required application/contract projects." -ForegroundColor Green

Write-Host "`nType-checking the Nx workspace..." -ForegroundColor Cyan
npm run typecheck:workspace
if ($LASTEXITCODE -ne 0) { throw 'Workspace type checking failed.' }

Write-Host "`nBuilding all four deployable Nx applications..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Nx application build failed.' }

Write-Host "`nRunning release validation..." -ForegroundColor Cyan
npm run validate:release
if ($LASTEXITCODE -ne 0) { throw 'Release validation failed.' }

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host 'PASS - NX DEVELOPMENT WORKSPACE READY' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host 'For the supported live runtime, use SETUP-TRUCK-LOG.cmd (Docker).'
Write-Host 'For local API/UI development, create a local .env with a reachable PostgreSQL host first,'
Write-Host 'then run START-TRUCK-LOG-DEVELOPMENT.cmd.'
