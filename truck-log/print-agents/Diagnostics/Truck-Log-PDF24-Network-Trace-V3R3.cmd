@echo off
setlocal DisableDelayedExpansion
echo Truck Log PDF24 Network Trace V3R3 - READ ONLY
echo Run on USFTWLDAPP as administrator. Only a new report file is written.
set "TL_PDF24_SELF=%~f0"
set "TL_PDF24_HASH=a11e684a417999809182298b8460ba335a6ec483c4290250746d46902e9ef19b"
set "TL_PDF24_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "TL_PDF24_PS=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%TL_PDF24_PS%" goto missing_ps
"%TL_PDF24_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQA9ACcAUwB0AG8AcAAnADsAdAByAHkAewAkAGwAPQBbAEkATwAuAEYAaQBsAGUAXQA6ADoAUgBlAGEAZABBAGwAbABMAGkAbgBlAHMAKAAkAGUAbgB2ADoAVABMAF8AUABEAEYAMgA0AF8AUwBFAEwARgAsAFsAVABlAHgAdAAuAEUAbgBjAG8AZABpAG4AZwBdADoAOgBVAFQARgA4ACkAOwAkAGIAPQBbAEEAcgByAGEAeQBdADoAOgBJAG4AZABlAHgATwBmACgAJABsACwAJwAjACMAIwBUAEwAXwBQAEQARgAyADQAXwBCAEUARwBJAE4AIwAjACMAJwApADsAJABlAD0AWwBBAHIAcgBhAHkAXQA6ADoASQBuAGQAZQB4AE8AZgAoACQAbAAsACcAIwAjACMAVABMAF8AUABEAEYAMgA0AF8ARQBOAEQAIwAjACMAJwApADsAaQBmACgAJABiACAALQBsAHQAIAAwACAALQBvAHIAIAAkAGUAIAAtAGwAZQAgACgAJABiACsAMQApACAALQBvAHIAIAAkAGIAIAAtAG4AZQAgAFsAQQByAHIAYQB5AF0AOgA6AEwAYQBzAHQASQBuAGQAZQB4AE8AZgAoACQAbAAsACcAIwAjACMAVABMAF8AUABEAEYAMgA0AF8AQgBFAEcASQBOACMAIwAjACcAKQAgAC0AbwByACAAJABlACAALQBuAGUAIABbAEEAcgByAGEAeQBdADoAOgBMAGEAcwB0AEkAbgBkAGUAeABPAGYAKAAkAGwALAAnACMAIwAjAFQATABfAFAARABGADIANABfAEUATgBEACMAIwAjACcAKQApAHsAdABoAHIAbwB3ACAAJwBJAG4AdgBhAGwAaQBkACAAbwByACAAZAB1AHAAbABpAGMAYQB0AGUAIABwAGEAeQBsAG8AYQBkACAAbQBhAHIAawBlAHIAcwAuACcAfQA7ACQAcAA9AFsAcwB0AHIAaQBuAGcAXQA6ADoASgBvAGkAbgAoACIAYABuACIALAAkAGwAWwAoACQAYgArADEAKQAuAC4AKAAkAGUALQAxACkAXQApADsAJABoAD0AWwBTAGUAYwB1AHIAaQB0AHkALgBDAHIAeQBwAHQAbwBnAHIAYQBwAGgAeQAuAFMASABBADIANQA2AF0AOgA6AEMAcgBlAGEAdABlACgAKQA7AHQAcgB5AHsAJABzAD0AKABbAEIAaQB0AEMAbwBuAHYAZQByAHQAZQByAF0AOgA6AFQAbwBTAHQAcgBpAG4AZwAoACQAaAAuAEMAbwBtAHAAdQB0AGUASABhAHMAaAAoAFsAVABlAHgAdAAuAEUAbgBjAG8AZABpAG4AZwBdADoAOgBVAFQARgA4AC4ARwBlAHQAQgB5AHQAZQBzACgAJABwACkAKQApACkALgBSAGUAcABsAGEAYwBlACgAJwAtACcALAAnACcAKQAuAFQAbwBMAG8AdwBlAHIASQBuAHYAYQByAGkAYQBuAHQAKAApAH0AZgBpAG4AYQBsAGwAeQB7ACQAaAAuAEQAaQBzAHAAbwBzAGUAKAApAH0AOwBpAGYAKAAkAHMAIAAtAGMAbgBlACAAJABlAG4AdgA6AFQATABfAFAARABGADIANABfAEgAQQBTAEgAKQB7AHQAaAByAG8AdwAgACcAUABhAHkAbABvAGEAZAAgAGkAbgB0AGUAZwByAGkAdAB5ACAAYwBoAGUAYwBrACAAZgBhAGkAbABlAGQALgAnAH0AOwAkAHQAPQAkAG4AdQBsAGwAOwAkAHgAPQAkAG4AdQBsAGwAOwAkAG4AdQBsAGwAPQBbAE0AYQBuAGEAZwBlAG0AZQBuAHQALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4ATABhAG4AZwB1AGEAZwBlAC4AUABhAHIAcwBlAHIAXQA6ADoAUABhAHIAcwBlAEkAbgBwAHUAdAAoACQAcAAsAFsAcgBlAGYAXQAkAHQALABbAHIAZQBmAF0AJAB4ACkAOwBpAGYAKAAkAG4AdQBsAGwAIAAtAG4AZQAgACQAeAAgAC0AYQBuAGQAIABAACgAJAB4ACkALgBDAG8AdQBuAHQAIAAtAGcAdAAgADAAKQB7AHQAaAByAG8AdwAgACgAJwBFAG0AYgBlAGQAZABlAGQAIABQAG8AdwBlAHIAUwBoAGUAbABsACAAcwB5AG4AdABhAHgAIABjAGgAZQBjAGsAIABmAGEAaQBsAGUAZAA6ACAAJwArACgAKAAkAHgAfABGAG8AcgBFAGEAYwBoAC0ATwBiAGoAZQBjAHQAewAkAF8ALgBNAGUAcwBzAGEAZwBlAH0AKQAtAGoAbwBpAG4AIAAnADsAIAAnACkAKQB9ADsAJgAgACgAWwBzAGMAcgBpAHAAdABiAGwAbwBjAGsAXQA6ADoAQwByAGUAYQB0AGUAKAAkAHAAKQApADsAZQB4AGkAdAAgADAAfQBjAGEAdABjAGgAewBXAHIAaQB0AGUALQBIAG8AcwB0ACAAKAAnAFsARgBBAEkATABdACAAJwArACQAXwAuAEUAeABjAGUAcAB0AGkAbwBuAC4ATQBlAHMAcwBhAGcAZQApADsAZQB4AGkAdAAgADEAfQA=
set "TL_PDF24_RC=%ERRORLEVEL%"
echo.
echo Collector exit code: %TL_PDF24_RC% -- 0=collection completed, 2=partial, 1=failed.
echo This is NOT a printer-repair result.
if /i not "%~1"=="/nopause" pause
exit /b %TL_PDF24_RC%
:missing_ps
echo [FAIL] Windows PowerShell was not found. No diagnostic reads were attempted.
if /i not "%~1"=="/nopause" pause
exit /b 1
###TL_PDF24_BEGIN###
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$script:ReportWriter = $null
$script:ReportPath = ''
$script:Partial = $false
$script:ProbeResults = @()

function Write-ReportLine([string]$Text = '') {
    Write-Host $Text
    if ($null -ne $script:ReportWriter) {
        $script:ReportWriter.WriteLine($Text)
        $script:ReportWriter.Flush()
    }
}

function Invoke-ReadProbe {
    param([string]$Name, [scriptblock]$Body, [int]$Seconds = 30)
    Write-ReportLine ''
    Write-ReportLine ('===== ' + $Name + ' =====')
    $job = $null
    $status = 'READ_OK'
    try {
        $job = Start-Job -ScriptBlock $Body
        $done = Wait-Job -Job $job -Timeout $Seconds
        if ($null -eq $done) {
            $status = 'TIMEOUT'
            $script:Partial = $true
            Write-ReportLine ('[TIMEOUT] This read exceeded ' + $Seconds + ' seconds; continuing with other checks.')
        } else {
            $readErrors = @()
            $items = @(Receive-Job -Job $job -ErrorAction SilentlyContinue -ErrorVariable readErrors)
            if ($items.Count -gt 0) {
                $text = ($items | Out-String -Width 320)
                if ($text.Length -gt 160000) {
                    $text = $text.Substring(0,160000) + "`r`n[TRUNCATED: section size limit]"
                    $script:Partial = $true
                    $status = 'TRUNCATED'
                }
                Write-ReportLine ($text.TrimEnd())
            } else {
                Write-ReportLine '[INFO] No data returned by this probe.'
            }
            if ($job.State -ne 'Completed' -or $readErrors.Count -gt 0) {
                $status = 'READ_INCOMPLETE'
                $script:Partial = $true
                foreach ($err in @($readErrors | Select-Object -First 6)) {
                    Write-ReportLine ('[READ ERROR] ' + $err.ToString())
                }
                Write-ReportLine ('[INFO] Probe state: ' + $job.State)
            }
        }
    } catch {
        $status = 'READ_FAILED'
        $script:Partial = $true
        Write-ReportLine ('[READ FAILED] ' + $_.Exception.Message)
    } finally {
        if ($null -ne $job) {
            # Only this collector's own temporary diagnostic job is stopped.
            if ($job.State -eq 'Running' -or $job.State -eq 'NotStarted') {
                Stop-Job -Job $job -ErrorAction SilentlyContinue
            }
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
        $script:ProbeResults += [pscustomobject]@{ Probe = $Name; Result = $status }
        Write-ReportLine ('[COLLECTOR] ' + $status)
    }
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'Windows is required. No diagnostic reads were attempted.' }
    if ($env:COMPUTERNAME -ine 'USFTWLDAPP') { throw 'Run this only on USFTWLDAPP, not the dock PC or USFTWPLVPS03.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Right-click the CMD on USFTWLDAPP and choose Run as administrator.'
    }
    if (-not [Environment]::Is64BitProcess) { throw 'The collector requires 64-bit Windows PowerShell.' }

    $fileName = 'Truck-Log-PDF24-Network-Trace-V3R3-RESULT-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8) + '.txt'
    $locations = @([Environment]::GetFolderPath('Desktop'), (Split-Path -Parent $env:TL_PDF24_SELF), [IO.Path]::GetTempPath())
    foreach ($location in $locations) {
        if ([string]::IsNullOrWhiteSpace($location) -or -not [IO.Directory]::Exists($location)) { continue }
        $stream = $null
        try {
            $path = Join-Path $location $fileName
            $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $encoding = New-Object Text.UTF8Encoding($true)
            $script:ReportWriter = New-Object IO.StreamWriter($stream, $encoding)
            $script:ReportPath = $path
            break
        } catch {
            if ($null -ne $stream) { $stream.Dispose() }
            Write-Host ('[INFO] Cannot save the report under ' + $location + '; trying the next report location.')
        }
    }
    if ($null -eq $script:ReportWriter) { throw 'No writable report location was found.' }

    Write-ReportLine 'TRUCK LOG PDF24 NETWORK TRACE V3R3 - READ ONLY'
    Write-ReportLine ('Time: ' + (Get-Date -Format 'o'))
    Write-ReportLine ('Computer: ' + $env:COMPUTERNAME)
    Write-ReportLine ('Account whose CURRENT USER settings are read: ' + $identity.Name)
    Write-ReportLine ('PowerShell: ' + $PSVersionTable.PSVersion.ToString())
    Write-ReportLine ('Report: ' + $script:ReportPath)
    Write-ReportLine 'Only a new report file is written. No PDF/document contents, spool files, credentials, or full registry exports are copied.'
    Write-ReportLine 'Job titles, user/computer names, printer paths, folder permissions and Windows print-event messages can appear in this report.'
    Write-ReportLine 'No queues/jobs/settings are changed; no services are started/restarted; no print jobs are sent; V3/Docker/Truck Log are untouched.'
    Write-ReportLine 'A READ_OK result means that evidence was collected, NOT that printing works.'

    Invoke-ReadProbe 'PDF24 service and running process metadata' {
        $ErrorActionPreference = 'Stop'
        $services = @(Get-CimInstance -ClassName Win32_Service -Filter "Name='pdf24' OR Name='Spooler' OR DisplayName LIKE '%PDF24%'" -OperationTimeoutSec 12)
        if ($services.Count -eq 0) { Write-Output '[INFO] No matching service was returned.' }
        $services | Select-Object Name,DisplayName,State,StartMode,StartName,ProcessId,ExitCode,ServiceSpecificExitCode,PathName | Format-List | Out-String -Width 320
        Get-CimInstance -ClassName Win32_Process -Filter "Name LIKE 'pdf24%'" -OperationTimeoutSec 12 |
            Select-Object Name,ProcessId,ParentProcessId,SessionId,ExecutablePath,CreationDate | Format-List | Out-String -Width 320
        foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if ([string]::IsNullOrWhiteSpace($base)) { continue }
            $exe = Join-Path $base 'PDF24\pdf24.exe'
            if (Test-Path -LiteralPath $exe -PathType Leaf) {
                Get-Item -LiteralPath $exe | Select-Object FullName,@{n='FileVersion';e={$_.VersionInfo.FileVersion}},@{n='ProductVersion';e={$_.VersionInfo.ProductVersion}} | Format-List | Out-String -Width 320
            }
        }
    } 35

    Invoke-ReadProbe 'Local queue identities, PDF24 ports, drivers and test jobs' {
        $ErrorActionPreference = 'Stop'
        Import-Module PrintManagement -ErrorAction Stop
        $all = @(Get-Printer -Full -ErrorAction Stop)
        'LOCAL PRINTER INVENTORY (includes local connections; no remote inventory query):'
        $all | Select-Object Name,Type,DriverName,PortName,Shared,ShareName,PrinterStatus | Format-List | Out-String -Width 320
        $targets = @($all | Where-Object {
            ([string]$_.DriverName -match '(?i)PDF24') -or
            ([string]$_.PortName).StartsWith('\\.\pipe\PDFPrint',[StringComparison]::OrdinalIgnoreCase) -or
            ([string]$_.Name -ieq 'DGL TEST') -or
            ([string]$_.Name -ieq 'TruckLog PDF24 - DGL TEST') -or
            ([string]$_.ShareName -ieq 'TruckLog_PDF24_DGL_TEST')
        })
        if ($targets.Count -eq 0) { throw 'No PDF24/DGL TEST candidate found. See inventory; do not substitute a physical Ricoh printer.' }
        'CANDIDATE DETAILS (the screenshot says DGL TEST; no rename or correction is attempted):'
        $targets | Select-Object Name,Type,DriverName,PortName,Shared,ShareName,PrinterStatus,JobCount,RenderingMode,PrintProcessor,Datatype,PermissionSDDL | Format-List | Out-String -Width 320
        'PDF24/CANDIDATE PORT DEFINITIONS:'
        $portNames = @($targets | Select-Object -ExpandProperty PortName)
        Get-PrinterPort | Where-Object { $portNames -contains $_.Name } | Select-Object Name,Description,PortMonitor,PrinterHostAddress,PortNumber | Format-List | Out-String -Width 320
        'CANDIDATE DRIVER METADATA:'
        $driverNames = @($targets | Select-Object -ExpandProperty DriverName -Unique)
        Get-PrinterDriver | Where-Object { $driverNames -contains $_.Name } | Select-Object Name,Manufacturer,MajorVersion,DriverVersion,PrinterEnvironment,InfPath,DriverPath | Format-List | Out-String -Width 320
        'WINDOWS QUEUE FLAGS:'
        $names = @($targets | Select-Object -ExpandProperty Name)
        Get-CimInstance -ClassName Win32_Printer -OperationTimeoutSec 12 | Where-Object { $names -contains $_.Name } |
            Select-Object Name,Local,Network,Shared,ShareName,PortName,DriverName,PrintProcessor,PrintJobDataType,Direct,SpoolEnabled,RawOnly,WorkOffline,EnableBIDI,PrinterStatus,DetectedErrorState | Format-List | Out-String -Width 320
        'CURRENT TEST/CAPTURE JOB METADATA (NOT print-job contents):'
        $jobs = @(Get-CimInstance -ClassName Win32_PrintJob -OperationTimeoutSec 12)
        $matched = @($jobs | Where-Object {
            $jobName = [string]$_.Name
            $comma = $jobName.LastIndexOf(',')
            ($comma -gt 0) -and ($names -contains $jobName.Substring(0,$comma).Trim())
        })
        if ($matched.Count -eq 0) { '[INFO] No candidate jobs returned at this snapshot; this does not prove PDF creation.' }
        $matched | Select-Object Name,JobId,HostPrintQueue,Owner,Document,DataType,DriverName,PrintProcessor,Status,JobStatus,StatusMask,Size,TotalPages,PagesPrinted,TimeSubmitted | Format-List | Out-String -Width 320
    } 60

    Invoke-ReadProbe 'Allowlisted PDF24 machine and current-user printer settings' {
        $ErrorActionPreference = 'Stop'
        # Only printer branches and named non-secret settings are read. Unknown values are omitted.
        $allowed = '^(InstallDir|Version|ProductVersion|Name|PrinterName|PortName|PrinterId|Tool|DefaultTool|PrinterTool|AutoSave|AutoSaveEnabled|AutoSaveDir|AutoSaveDirectory|AutoSaveFolder|AutoSaveFileName|AutoSaveProfile|AutoSaveShowProgress|AutoSaveOpenFolder|AutoSaveOpenFile|AutoSaveOverwrite|AutoSaveOverwriteExistingFile|AutoSaveShowProgressOnSave|OpenInCreator|OpenInAssistant|OpenInCreatorIfOpened|ShowProgress|OpenFolderAfterSave|SaveMode|SaveDir|SaveDirectory|SaveFileName|SaveProfile|DeletePrintJobsWithError)$'
        $roots = @('HKLM:\SOFTWARE\PDF24','HKCU:\SOFTWARE\PDF24','HKLM:\SOFTWARE\WOW6432Node\PDF24','HKCU:\SOFTWARE\WOW6432Node\PDF24')
        foreach ($root in $roots) {
            ('SCOPE: ' + $root)
            if (-not (Test-Path -LiteralPath $root)) { '[INFO] Scope absent.'; continue }
            $rootKey = Get-Item -LiteralPath $root
            $queue = New-Object System.Collections.Queue
            $queue.Enqueue([pscustomobject]@{Key=$rootKey;Depth=0})
            $visited = 0
            while ($queue.Count -gt 0 -and $visited -lt 100) {
                $entry = $queue.Dequeue()
                $key = $entry.Key
                $visited++
                try {
                    foreach ($valueName in @($key.GetValueNames())) {
                        $normal = $valueName -replace '[!._ -]',''
                        if ($normal -notmatch $allowed) { continue }
                        $kind = [string]$key.GetValueKind($valueName)
                        if ($kind -notin @('String','ExpandString','DWord','QWord')) { continue }
                        $value = [string]$key.GetValue($valueName,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                        if ($value.Length -gt 700) { $value = $value.Substring(0,700) + '[truncated]' }
                        ('{0} | {1} [{2}] = {3}' -f $key.Name,$valueName,$kind,$value)
                    }
                    if ($entry.Depth -lt 3) {
                        foreach ($subName in @($key.GetSubKeyNames())) {
                            # At the root, only traverse explicitly printer-related branches.
                            if ($entry.Depth -eq 0 -and $subName -notmatch '(?i)^printers?$|^pdfprinters?$|^printersettings$') { continue }
                            if ($subName -match '(?i)password|credential|token|secret|certificate|mail|fax|profiles?') { continue }
                            $child = Get-Item -LiteralPath ('Registry::' + $key.Name + '\' + $subName)
                            $queue.Enqueue([pscustomobject]@{Key=$child;Depth=($entry.Depth+1)})
                        }
                    }
                } finally { $key.Close() }
            }
            while ($queue.Count -gt 0) { $queue.Dequeue().Key.Close() }
            if ($visited -ge 100) { '[INFO] Printer-key scan limit reached; additional keys omitted.' }
        }
        'Undocumented setting names/branches may be omitted. HKCU is only the elevated account shown in the report header.'
    } 25

    Invoke-ReadProbe 'Isolated DGL test folder: existence, permissions and file metadata' {
        $ErrorActionPreference = 'Stop'
        $folder = 'C:\TruckLog\PDF24-Test\DGL'
        ('TEST FOLDER: ' + $folder)
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) { '[INFO] The intended test folder does not exist for this host snapshot.'; return }
        $item = Get-Item -LiteralPath $folder
        $item | Select-Object FullName,Attributes,CreationTime,LastWriteTime | Format-List | Out-String -Width 320
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { '[INFO] Reparse-point folder: no traversal performed.'; return }
        $acl = Get-Acl -LiteralPath $folder
        $acl | Select-Object Owner,Sddl | Format-List | Out-String -Width 320
        $acl.Access | Select-Object IdentityReference,FileSystemRights,AccessControlType,IsInherited,InheritanceFlags,PropagationFlags | Format-Table -AutoSize | Out-String -Width 320
        $files = @(Get-ChildItem -LiteralPath $folder -File | Sort-Object LastWriteTime -Descending | Select-Object -First 15)
        if ($files.Count -eq 0) { '[INFO] Folder currently contains no files.' }
        $files | Select-Object Name,Length,CreationTime,LastWriteTime | Format-Table -AutoSize | Out-String -Width 320
        'No folder access was tested under the PDF24 service identity. ACL display alone is not a write-permission test.'
    } 20

    Invoke-ReadProbe 'Existing Windows PrintService events - last 8 hours' {
        $ErrorActionPreference = 'Stop'
        $since = (Get-Date).AddHours(-8)
        foreach ($log in @('Microsoft-Windows-PrintService/Admin','Microsoft-Windows-PrintService/Operational')) {
            ('EVENT LOG: ' + $log)
            $info = Get-WinEvent -ListLog $log -ErrorAction Stop
            $info | Select-Object LogName,IsEnabled,RecordCount,LastWriteTime | Format-List | Out-String -Width 320
            if (-not $info.IsEnabled) { '[INFO] Log is disabled. It has NOT been enabled by this collector.'; continue }
            try {
                $events = @(Get-WinEvent -FilterHashtable @{LogName=$log;StartTime=$since} -MaxEvents 60 -ErrorAction Stop)
                $events | Select-Object TimeCreated,Id,RecordId,LevelDisplayName,ProviderName,Message | Format-List | Out-String -Width 320
                if ($events.Count -eq 60) { '[INFO] Limited to 60 newest records in the time window; older events may be omitted.' }
            } catch {
                if ($_.FullyQualifiedErrorId -match 'NoMatchingEventsFound') { '[INFO] No matching events in the time window.' } else { throw }
            }
        }
    } 40

    Invoke-ReadProbe 'PDF24-related application crashes - last 8 hours' {
        $ErrorActionPreference = 'Stop'
        try {
            $events = @(Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=(Get-Date).AddHours(-8);Level=@(1,2,3)} -MaxEvents 300 -ErrorAction Stop)
            $pdfEvents = @($events | Where-Object { $_.ProviderName -match '(?i)pdf24' -or $_.Message -match '(?i)pdf24|pdfprint' } | Select-Object -First 20)
            if ($pdfEvents.Count -eq 0) { '[INFO] No PDF24-related entry among the 300 newest application warnings/errors in the window.' }
            $pdfEvents | Select-Object TimeCreated,Id,RecordId,LevelDisplayName,ProviderName,Message | Format-List | Out-String -Width 320
        } catch {
            if ($_.FullyQualifiedErrorId -match 'NoMatchingEventsFound') { '[INFO] No application warnings/errors in the time window.' } else { throw }
        }
    } 30

    Write-ReportLine ''
    Write-ReportLine 'FINAL SUMMARY'
    Write-ReportLine (($script:ProbeResults | Format-Table -AutoSize | Out-String -Width 180).TrimEnd())
    if ($script:Partial) { Write-ReportLine 'COLLECTION: PARTIAL - send this report; unavailable reads are identified above.' }
    else { Write-ReportLine 'COLLECTION: PASS - read probes completed; this does NOT mean the printer works.' }
    Write-ReportLine 'PRINTER_REPAIR: NOT_ATTEMPTED'
    Write-ReportLine 'NETWORK_PDF_CREATION: NOT_VERIFIED'
    Write-ReportLine 'PAPER_OUTPUT: NOT_TESTED'
    Write-ReportLine 'Existing queued jobs, settings, services, saved PDFs, V3 controller and Truck Log were not changed by this collector.'
    Write-ReportLine ('REPORT: ' + $script:ReportPath)
    Write-ReportLine 'Review this report, then upload this RESULT text file. Do not repeatedly resubmit the stuck test jobs.'
    $script:ReportWriter.Dispose()
    $script:ReportWriter = $null
    try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\notepad.exe') -ArgumentList ('"' + $script:ReportPath + '"') -ErrorAction Stop | Out-Null }
    catch { Write-Host ('[INFO] Notepad did not open. Open the report manually: ' + $script:ReportPath) }
    if ($script:Partial) { exit 2 } else { exit 0 }
} catch {
    Write-ReportLine ('[FAIL] ' + $_.Exception.Message)
    Write-ReportLine 'No repair was attempted.'
    if ($script:ReportPath) { Write-ReportLine ('Partial report: ' + $script:ReportPath) }
    exit 1
} finally {
    if ($null -ne $script:ReportWriter) { $script:ReportWriter.Dispose() }
}
###TL_PDF24_END###
