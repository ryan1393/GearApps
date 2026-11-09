# Optional. Removes only this package's own named logon task; does not affect original V3.
$ErrorActionPreference='Stop'
$name='TruckLogSAPCaptureWatcher-Restored'
$task=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if (-not $task) { Write-Host '[OK] This package has no installed sign-in task.'; return }
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
Write-Host ('[PASS] Removed only ' + $name + '. The running watcher, if any, must be stopped separately.')
