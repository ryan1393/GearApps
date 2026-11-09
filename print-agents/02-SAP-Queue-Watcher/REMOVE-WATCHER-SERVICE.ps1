# Stops and removes the Windows service TruckLogPackingSlipWatcher. Run as Administrator via
# REMOVE-WATCHER-SERVICE.cmd. Never deletes the state folder (logs, journal, outbox, credential,
# route-config.json) or any packing-slip PDF.
#   -DeleteProgramFiles  also delete %ProgramFiles%\TruckLog\PackingSlipWatcher (program, venv, watcher.ini)
[CmdletBinding()]
param([switch]$DeleteProgramFiles)
$ErrorActionPreference = 'Stop'
$ServiceName = 'TruckLogPackingSlipWatcher'
$InstallDir = Join-Path $env:ProgramFiles 'TruckLog\PackingSlipWatcher'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '[FAIL] Run REMOVE-WATCHER-SERVICE.cmd with "Run as administrator".'; exit 1
}
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
  Write-Host "[OK] Service $ServiceName is not installed."
} else {
  if ($svc.Status -ne 'Stopped') {
    Write-Host 'Stopping the service (the watcher finishes the current capture first)...'
    Stop-Service -Name $ServiceName -ErrorAction Stop
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
  }
  & (Join-Path $env:SystemRoot 'System32\sc.exe') delete $ServiceName
  if ($LASTEXITCODE -ne 0) { Write-Host "[FAIL] sc.exe delete returned $LASTEXITCODE."; exit 1 }
  Write-Host "[PASS] Service $ServiceName removed."
}
if ($DeleteProgramFiles -and (Test-Path -LiteralPath $InstallDir)) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
  Write-Host "[PASS] Deleted $InstallDir."
} elseif (Test-Path -LiteralPath $InstallDir) {
  Write-Host "[INFO] Program files kept in $InstallDir (use -DeleteProgramFiles to delete them)."
}
Write-Host 'The state folder (logs, outbox, credential, route-config.json) and all PDFs were left untouched.'
Write-Host 'Nothing now watches the capture queues. Use START-WATCHER.cmd for a console run or re-install the service.'
exit 0
