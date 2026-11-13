# Installs (or upgrades) the Truck Log SAP packing-slip watcher as the Windows service
# "TruckLogPackingSlipWatcher" (LocalSystem, automatic delayed start, restart on failure).
# Run as Administrator via INSTALL-WATCHER-SERVICE.cmd. Does not change printers, print queues,
# the guard service TruckLogPrintAgent, Truck Log, or the original V3 installation.
#
#   -RemoveSignInTask   remove this package's old sign-in task without asking
#   -ReplaceConfig      overwrite the installed watcher.ini (a dated backup is kept)
#   -PythonExe <path>   base Python 3.10+ to build the service venv from (default: py -3 / python)
#   -AllowPerUserPython allow a Python installed under C:\Users (NOT recommended: LocalSystem would run
#                       code from a folder that user can change)
#   -WithOcr            also install requirements-ocr-optional.txt (Tesseract must be installed separately)
#   -NoStart            register but do not start
[CmdletBinding()]
param(
  [switch]$RemoveSignInTask,
  [switch]$ReplaceConfig,
  [string]$PythonExe,
  [switch]$AllowPerUserPython,
  [switch]$WithOcr,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$ServiceName = 'TruckLogPackingSlipWatcher'
$DisplayName = 'Truck Log Packing Slip Watcher'
$OldTaskName = 'TruckLogSAPCaptureWatcher-Restored'
$Package = $PSScriptRoot
$InstallDir = Join-Path $env:ProgramFiles 'TruckLog\PackingSlipWatcher'
$HostExe = Join-Path $InstallDir 'TruckLogPackingSlipWatcher.exe'
$ProgramFiles = @('sap_capture_watcher.py', 'WatcherServiceHost.cs', 'requirements.txt', 'requirements-ocr-optional.txt', 'README.txt')

function Fail([string]$message) { Write-Host ('[FAIL] ' + $message) -ForegroundColor Red; exit 1 }
function Run-Native([string]$exe, [string[]]$arguments, [string]$what) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { Fail ("$what failed (exit $LASTEXITCODE). Nothing further was changed.") }
}

function Set-WatcherAcl([string]$Path, [bool]$Directory, [bool]$UsersRead) {
  # Replace the DACL exactly, including unwanted explicit grants. No /reset or
  # inherited ACL is applied to secrets, even temporarily, during an upgrade.
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to change watcher ACLs through a linked path: $Path"
  }
  if ($Directory) { $acl = New-Object Security.AccessControl.DirectorySecurity }
  else { $acl = New-Object Security.AccessControl.FileSecurity }
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]::None
  if ($Directory) {
    $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  }
  $propagation = [Security.AccessControl.PropagationFlags]::None
  $allow = [Security.AccessControl.AccessControlType]::Allow
  foreach ($sidText in @('S-1-5-18', 'S-1-5-32-544')) {
    $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, $propagation, $allow)
    [void]$acl.AddAccessRule($rule)
  }
  if ($UsersRead) {
    $sid = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::ReadAndExecute, $inherit, $propagation, $allow)
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
}

Write-Host 'Truck Log SAP packing-slip watcher - install/upgrade Windows service'
Write-Host ('Package:  ' + $Package)
Write-Host ('Install:  ' + $InstallDir)

# 1. Administrator
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'Run INSTALL-WATCHER-SERVICE.cmd with "Run as administrator".'
}
foreach ($f in $ProgramFiles + @('watcher.ini')) {
  if (-not (Test-Path -LiteralPath (Join-Path $Package $f) -PathType Leaf)) { Fail "Package file missing: $f" }
}
$csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc -PathType Leaf)) { Fail "Windows .NET Framework C# compiler not found: $csc. Nothing installed." }

# 2. Existing service? Only our own service may be upgraded.
$existing = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
$upgrade = $false
if ($existing) {
  if ([string]$existing.PathName -notlike ('*' + $HostExe + '*')) {
    Fail ("A service named $ServiceName already exists with a different program: " + $existing.PathName)
  }
  $upgrade = $true
  Write-Host ('[INFO] Existing service found (' + $existing.State + '): upgrading in place.')
}

# 3. Old sign-in task (this package) and any other SAP watcher startup task (e.g. original V3)
$tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
  $t = $_
  $a = @($t.Actions) | ForEach-Object { [string]$_.Execute + ' ' + [string]$_.Arguments }
  $t.TaskName -eq $OldTaskName -or (($a -join ' ') -match 'Truck-Log-SAP-Capture|truck_log_print_server|sap_capture_watcher|START-WATCHER\.cmd')
})
$ownTask = @($tasks | Where-Object { $_.TaskName -eq $OldTaskName })
$otherTasks = @($tasks | Where-Object { $_.TaskName -ne $OldTaskName })
if ($otherTasks.Count -gt 0) {
  Fail ('Other SAP watcher startup task(s) exist: ' + (($otherTasks | ForEach-Object { $_.TaskPath + $_.TaskName }) -join ', ') +
        '. Disable/remove them (and stop that watcher) first. Nothing changed.')
}
if ($ownTask.Count -gt 0) {
  Write-Host "[INFO] The old sign-in task '$OldTaskName' exists. The service replaces it."
  $remove = $RemoveSignInTask
  if (-not $remove) {
    $answer = Read-Host 'Remove the sign-in task now? [y/N]'
    $remove = ($answer -match '^(y|yes)$')
  }
  if (-not $remove) { Fail 'Sign-in task kept. Remove it (REMOVE-USER-LOGON-TASK.ps1) or re-run and answer y. Nothing changed.' }
}

# 4. Base Python
if (-not $PythonExe) {
  $pkgVenvCfg = Join-Path $Package '.venv\pyvenv.cfg'
  if (Test-Path -LiteralPath $pkgVenvCfg) {
    $homeLine = Get-Content -LiteralPath $pkgVenvCfg | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1
    if ($homeLine) { $candidate = Join-Path (($homeLine -split '=', 2)[1].Trim()) 'python.exe'; if (Test-Path -LiteralPath $candidate) { $PythonExe = $candidate } }
  }
}
if (-not $PythonExe) {
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) { $PythonExe = (& $py.Source -3 -c 'import sys; print(sys.executable)').Trim() }
}
if (-not $PythonExe) {
  $p = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($p -and $p.Source -notlike '*\WindowsApps\*') { $PythonExe = $p.Source }
}
if (-not $PythonExe -or -not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
  Fail 'Python 3.10+ not found. Install Python for ALL USERS (C:\Program Files\Python3xx) or pass -PythonExe.'
}
$PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
& $PythonExe -I -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'
if ($LASTEXITCODE -ne 0) { Fail "$PythonExe is older than Python 3.10." }
if ($PythonExe -like ($env:SystemDrive + '\Users\*') -and -not $AllowPerUserPython) {
  Fail ("$PythonExe is a per-user Python. The service runs as LocalSystem and must not run code from a folder a " +
        'normal user can change. Install Python for all users, or re-run with -AllowPerUserPython (not recommended).')
}
Write-Host ('Python:   ' + $PythonExe)
$watcherPy = Join-Path $Package 'sap_capture_watcher.py'

# 5. Stop the old service (upgrade) and remove the sign-in task, then refuse if any watcher still runs
if ($upgrade -and (Get-Service -Name $ServiceName).Status -ne 'Stopped') {
  Write-Host '[INFO] Stopping the service for the upgrade...'
  Stop-Service -Name $ServiceName -ErrorAction Stop
  (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
}
& $PythonExe -I $watcherPy conflicts
if ($LASTEXITCODE -eq 3) {
  Fail 'Another SAP watcher is running (console window, sign-in task or original V3). Stop it gracefully (Ctrl+C in its window) and re-run.'
} elseif ($LASTEXITCODE -ne 0) { Fail 'Could not check for running SAP watchers (fail-closed).' }
if ($ownTask.Count -gt 0) {
  Unregister-ScheduledTask -TaskName $OldTaskName -Confirm:$false -ErrorAction Stop
  Write-Host "[PASS] Removed the old sign-in task '$OldTaskName'."
}

# 6. Program files (Program Files ACL: only Administrators/SYSTEM can change them)
[void](New-Item -ItemType Directory -Path $InstallDir -Force)
foreach ($f in $ProgramFiles) { Copy-Item -LiteralPath (Join-Path $Package $f) -Destination (Join-Path $InstallDir $f) -Force }
$installedIni = Join-Path $InstallDir 'watcher.ini'
if (Test-Path -LiteralPath $installedIni) {
  if ($ReplaceConfig) {
    $backup = $installedIni + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath $installedIni -Destination $backup
    Copy-Item -LiteralPath (Join-Path $Package 'watcher.ini') -Destination $installedIni -Force
    Write-Host "[INFO] watcher.ini replaced (backup: $backup)."
  } else {
    Write-Host "[INFO] Keeping the installed $installedIni (use -ReplaceConfig to overwrite it)."
  }
} else {
  Copy-Item -LiteralPath (Join-Path $Package 'watcher.ini') -Destination $installedIni
  Write-Host "[INFO] Installed watcher.ini from the package."
}
$installedPy = Join-Path $InstallDir 'sap_capture_watcher.py'

# 7. Service venv
$venvPy = Join-Path $InstallDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPy)) {
  Run-Native $PythonExe @('-m', 'venv', (Join-Path $InstallDir '.venv')) 'Creating the service venv'
}
if ($WithOcr) {
  & $venvPy -I -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'
  if ($LASTEXITCODE -ne 0) {
    Fail 'OCR requires Python 3.11+ for patched Pillow 13. Recreate the service venv with Python 3.11+ before using -WithOcr; the text-only watcher still supports Python 3.10.'
  }
}
Run-Native $venvPy @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', (Join-Path $InstallDir 'requirements.txt')) 'Installing Python packages'
if ($WithOcr) {
  Run-Native $venvPy @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', (Join-Path $InstallDir 'requirements-ocr-optional.txt')) 'Installing OCR packages'
}

# 8. Validate the installed watcher.ini (refuses old live_print_armed / route lines)
$pathsJson = & $venvPy -I $installedPy paths --config $installedIni
if ($LASTEXITCODE -ne 0) { Fail "Installed $installedIni is not valid for this version (see the message above). Fix it, then re-run." }
$paths = $pathsJson | ConvertFrom-Json
$stateDir = $paths.stateDir.TrimEnd('\')
Write-Host ('State:    ' + $stateDir)

# 9. Protect an existing credential BEFORE making nonsecret state readable.
# Exact private grants: *S-1-5-18:F and *S-1-5-32-544:F, no inherited grants.
# This also handles a credential configured outside stateDir. A failure aborts
# before any broader directory ACL is applied; its old private ACL is never reset.
if (Test-Path -LiteralPath $paths.credentialFile -PathType Leaf) {
  Set-WatcherAcl $paths.credentialFile $false $false
}
[void](New-Item -ItemType Directory -Path $stateDir -Force)
Set-WatcherAcl $stateDir $true $true
# Preserve existing child ACLs (especially the protected credential). New logs and
# state files inherit Users:read; this upgrade never recursively resets children.

# 10. Credential: must be DPAPI LocalMachine for LocalSystem; file readable by SYSTEM + Administrators only
$credOk = $false
$cred = $paths.credentialFile
if ($paths.credentialProtection -eq 'missing') {
  Write-Warning "No Truck Log credential yet ($cred). Run SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator after this."
} elseif ($paths.dpapiScope -ne 'LocalMachine' -and $paths.credentialFormat -eq 'dpapi') {
  Write-Warning "[truck_log] dpapi_scope is $($paths.dpapiScope) in $installedIni. Set dpapi_scope = LocalMachine for the service."
} else {
  # Re-seals a CurrentUser credential as LocalMachine (works when you are the user who stored it) and fixes the ACL.
  & $venvPy -I $installedPy migrate-credential --config $installedIni
  if ($LASTEXITCODE -eq 0) { $credOk = $true }
  else { Write-Warning ("Could not migrate $cred (stored by another Windows user?). Run SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator " +
                       'and paste the token again (or issue a new one with --rotate on the Truck Log host).') }
}
if (-not $credOk) {
  Write-Warning 'Until the credential is fixed the service cannot reach Truck Log: it uses the cached route settings, or every route TEST with upload off.'
}

# 11. Compile the service host
$newExe = $HostExe + '.new'
Run-Native $csc @('/nologo', '/target:exe', '/platform:x64', '/optimize+', ('/out:' + $newExe), '/reference:System.ServiceProcess.dll', (Join-Path $InstallDir 'WatcherServiceHost.cs')) 'Compiling the service host'
Move-Item -LiteralPath $newExe -Destination $HostExe -Force

# 12. Register / update the service
$binPath = '"' + $HostExe + '" --service "' + $stateDir + '"'
$sc = Join-Path $env:SystemRoot 'System32\sc.exe'
if (-not $upgrade) {
  New-Service -Name $ServiceName -BinaryPathName $binPath -DisplayName $DisplayName -StartupType Automatic -DependsOn 'Spooler' `
    -Description 'Truck Log SAP packing-slip capture watcher. Route settings come from Truck Log > Admin > Printing. Logs in the state folder.' | Out-Null
} else {
  Set-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $ServiceName) -Name ImagePath -Value $binPath
}
Run-Native $sc @('config', $ServiceName, 'start=', 'delayed-auto', 'obj=', 'LocalSystem') 'Setting delayed automatic start'
Run-Native $sc @('failure', $ServiceName, 'reset=', '86400', 'actions=', 'restart/10000/restart/30000/restart/60000') 'Setting restart on failure'
Run-Native $sc @('failureflag', $ServiceName, '1') 'Setting failure flag'
Write-Host "[PASS] Service $ServiceName registered (LocalSystem, Automatic (Delayed Start), restart on failure)."

# 13. Start
if ($NoStart) { Write-Host 'Not started (-NoStart). Start it with: Start-Service TruckLogPackingSlipWatcher'; exit 0 }
Start-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
Start-Sleep -Seconds 8
$svc = Get-Service -Name $ServiceName
Write-Host ('Service status: ' + $svc.Status)
$log = Join-Path $stateDir 'watcher.log'
if (Test-Path -LiteralPath $log) { Write-Host '--- last lines of watcher.log ---'; Get-Content -LiteralPath $log -Tail 15 }
if ($svc.Status -ne 'Running') { Fail 'The service is not running. See service-host.log, watcher-service-console.log and watcher.log in the state folder.' }
Write-Host '[PASS] Installed. Check route settings with STATUS-WATCHER-SERVICE.cmd; change them in Truck Log > Admin > Printing.'
exit 0
