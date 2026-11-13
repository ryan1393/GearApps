# Uninstalls the guard print service TruckLogPrintAgent from this PC so a fresh V4R7 install
# can run. Run as Administrator via REMOVE-OLD-PRINT-AGENT.cmd.
#   default       stop and delete the service; move its folder (program, settings, credential,
#                 unsent results) into the locked folder %ProgramData%\Dana\_patch_backups
#   -DeleteFiles  delete that folder and every earlier backup in _patch_backups instead
# Does not touch Truck Log, queued print jobs on the server, printers or the SAP watcher.
[CmdletBinding()]
param([switch]$DeleteFiles)
$ErrorActionPreference = 'Stop'
$ServiceName = 'TruckLogPrintAgent'
$Parent = Join-Path $env:ProgramData 'Dana'
$InstallDir = Join-Path $Parent 'TruckLogPrintAgent'
$BackupRoot = Join-Path $Parent '_patch_backups'
$Sc = Join-Path $env:SystemRoot 'System32\sc.exe'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '[FAIL] Run REMOVE-OLD-PRINT-AGENT.cmd with "Run as administrator".'; exit 1
}

function Test-PlainFolder([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  # A junction or symbolic link could point the removal at another folder.
  return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
}

Write-Host 'TRUCK LOG GUARD PRINT AGENT - REMOVE OLD INSTALLATION'
Write-Host ('Host: ' + $env:COMPUTERNAME)
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$hasFolder = Test-Path -LiteralPath $InstallDir
$hasBackups = Test-Path -LiteralPath $BackupRoot
if ($svc) { Write-Host ('Service ' + $ServiceName + ': ' + $svc.Status) } else { Write-Host ('Service ' + $ServiceName + ': not installed') }
Write-Host ('Folder ' + $InstallDir + ': ' + $(if ($hasFolder) { 'present' } else { 'not present' }))
if ($hasBackups) { Write-Host ('Earlier backups: ' + $BackupRoot) }

$agentId = ''
$configFile = Join-Path $InstallDir 'config.json'
if (Test-Path -LiteralPath $configFile -PathType Leaf) {
  try { $agentId = [string]((Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json).agentId) } catch { $agentId = '' }
}
if ($agentId) { Write-Host ('Installed agent identity: ' + $agentId) }

if (-not $svc -and -not $hasFolder -and -not ($DeleteFiles -and $hasBackups)) {
  Write-Host '[OK] No old guard print agent is installed. Nothing to remove.'
  exit 0
}
if ($hasFolder -and -not (Test-PlainFolder $InstallDir)) {
  Write-Host ('[FAIL] ' + $InstallDir + ' is not an ordinary folder. Nothing was changed.'); exit 1
}
if ($DeleteFiles -and $hasBackups -and -not (Test-PlainFolder $BackupRoot)) {
  Write-Host ('[FAIL] ' + $BackupRoot + ' is not an ordinary folder. Nothing was changed.'); exit 1
}

Write-Host ''
Write-Host 'This stops automatic guard-gate printing on this PC until the agent is installed again.'
Write-Host 'Jobs already queued in Truck Log stay queued. Guards can print manually in the browser meanwhile.'
if ($DeleteFiles) {
  Write-Host 'The agent folder and all earlier backups will be DELETED, including the saved credential'
  Write-Host 'and any print results not yet delivered to Truck Log.'
} else {
  Write-Host ('The agent folder will be MOVED into ' + $BackupRoot + ' (not deleted).')
}
$answer = Read-Host 'Type REMOVE to continue'
if ($answer -cne 'REMOVE') { Write-Host 'Canceled. Nothing was changed.'; exit 1 }

if ($svc) {
  if ($svc.Status -ne 'Stopped') {
    Write-Host 'Stopping the service (it finishes the current print job first)...'
    Stop-Service -Name $ServiceName -Force -ErrorAction Stop
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
  }
  & $Sc delete $ServiceName | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host ('[FAIL] sc.exe delete returned ' + $LASTEXITCODE + '. The folder was left in place.'); exit 1 }
  $gone = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { $gone = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $gone) {
    Write-Host '[FAIL] Windows has not finished removing the service. Close the Services window and'
    Write-Host '       Task Manager (or restart the PC), then run this again. The folder was left in place.'
    exit 1
  }
  Write-Host ('[PASS] Service ' + $ServiceName + ' removed.')
}

# A lock left behind by an interrupted installer would make the next install refuse to start.
$staleLock = Join-Path $Parent '.TruckLogPrintAgent-install.lock'
if (Test-Path -LiteralPath $staleLock -PathType Leaf) { Remove-Item -LiteralPath $staleLock -Force; Write-Host '[PASS] Removed a leftover installer lock.' }

if ($DeleteFiles) {
  if ($hasFolder) { Remove-Item -LiteralPath $InstallDir -Recurse -Force; Write-Host ('[PASS] Deleted ' + $InstallDir + '.') }
  if ($hasBackups) { Remove-Item -LiteralPath $BackupRoot -Recurse -Force; Write-Host ('[PASS] Deleted ' + $BackupRoot + '.') }
} elseif ($hasFolder) {
  if (-not (Test-Path -LiteralPath $BackupRoot)) {
    [void](New-Item -ItemType Directory -Path $BackupRoot)
    # Same protection the installer gives this folder: SYSTEM and Administrators only.
    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $BackupRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host '[FAIL] Could not protect the backup folder. The agent folder was left in place.'; exit 1 }
  }
  $backup = Join-Path $BackupRoot ('removed-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Move-Item -LiteralPath $InstallDir -Destination $backup
  Write-Host ('[PASS] Old agent folder moved to ' + $backup + '.')
  Write-Host '       Run this again with -DeleteFiles to delete the backups once the new agent works.'
}

Write-Host ''
Write-Host 'NEXT:'
Write-Host ' 1. On the Truck Log Docker host, from the truck-log folder, create a new token for this PC:'
if ($agentId) { Write-Host ('      SETUP-PRINT-AGENT-CREDENTIAL --agent-id ' + $agentId + ' --name "Guard shack printer PC" --rotate') }
else { Write-Host '      SETUP-PRINT-AGENT-CREDENTIAL --agent-id <agent id> --name "Guard shack printer PC" --rotate' }
Write-Host ' 2. On this PC, run Truck-Log-Dual-Gate-Print-Agent-Service-V4R7.cmd as administrator.'
exit 0
