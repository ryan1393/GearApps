# Read-only status of the Windows service TruckLogPackingSlipWatcher: registration, account, start
# type, recovery actions, recent log lines and the watcher's own check (Truck Log reachable?,
# route settings version, per-route mode/printer/upload, cache age). Changes nothing; prints nothing.
# Run as Administrator to let the check read the credential (SYSTEM + Administrators only).
$ErrorActionPreference = 'Continue'
$ServiceName = 'TruckLogPackingSlipWatcher'
$InstallDir = Join-Path $env:ProgramFiles 'TruckLog\PackingSlipWatcher'
Write-Host 'TRUCK LOG PACKING SLIP WATCHER - SERVICE STATUS (read-only)'
Write-Host ('Host: ' + $env:COMPUTERNAME + '  Time: ' + (Get-Date))
$w = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
if (-not $w) {
  Write-Warning "Service $ServiceName is NOT installed (run INSTALL-WATCHER-SERVICE.cmd as Administrator)."
} else {
  $delayed = (Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $ServiceName) -Name DelayedAutostart -ErrorAction SilentlyContinue).DelayedAutostart
  Write-Host ('Service:  ' + $w.State + '   start: ' + $w.StartMode + $(if ($delayed -eq 1) { ' (Delayed)' } else { '' }) + '   account: ' + $w.StartName + '   pid: ' + $w.ProcessId)
  Write-Host ('Program:  ' + $w.PathName)
  & (Join-Path $env:SystemRoot 'System32\sc.exe') qfailure $ServiceName | Select-String -Pattern 'RESET|RESTART' | ForEach-Object { Write-Host ('Recovery: ' + $_.Line.Trim()) }
}
foreach ($name in @('Spooler', 'TruckLogPrintAgent')) {
  $s = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($s) { Write-Host ('Service ' + $name + ': ' + $s.Status) } else { Write-Warning ('Service ' + $name + ' not found') }
}
$task = Get-ScheduledTask -TaskName 'TruckLogSAPCaptureWatcher-Restored' -ErrorAction SilentlyContinue
if ($task) { Write-Warning 'The old sign-in task TruckLogSAPCaptureWatcher-Restored still exists (INSTALL-WATCHER-SERVICE.cmd offers to remove it).' }
$venvPy = Join-Path $InstallDir '.venv\Scripts\python.exe'
$py = Join-Path $InstallDir 'sap_capture_watcher.py'
$ini = Join-Path $InstallDir 'watcher.ini'
if ((Test-Path -LiteralPath $venvPy) -and (Test-Path -LiteralPath $ini)) {
  $paths = & $venvPy -I $py paths --config $ini | ConvertFrom-Json
  if ($paths) {
    foreach ($log in @('watcher.log', 'service-host.log', 'watcher-service-console.log')) {
      $p = Join-Path $paths.stateDir $log
      if (Test-Path -LiteralPath $p) { Write-Host "--- last lines of $p ---"; Get-Content -LiteralPath $p -Tail 12 }
    }
  }
  Write-Host ''
  Write-Host "--- watcher check (installed config $ini) ---"
  & $venvPy -I $py check --config $ini
} else {
  Write-Warning "No installed watcher in $InstallDir."
}
Write-Host 'STATUS COMPLETE - no changes were made.'
