@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Truck Log - Print Agent Read-Only Audit V1
set "TLPRINT_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';try{$raw=[IO.File]::ReadAllText($env:TLPRINT_SELF);$a='::'+'TLPRINT_PS_BEGIN';$b='::'+'TLPRINT_PS_END';$i=$raw.IndexOf($a,[StringComparison]::Ordinal);$j=$raw.IndexOf($b,[StringComparison]::Ordinal);if($i -lt 0 -or $j -le $i){throw 'Missing embedded audit script'};$code=$raw.Substring($i+$a.Length,$j-$i-$a.Length);$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseInput($code,[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{Write-Host ('[FAIL] Audit PowerShell parser: '+$_.Message)};exit 1};&([ScriptBlock]::Create($code))}catch{Write-Host ('[FAIL] Unable to run the read-only audit.');exit 1}"
set "TLPRINT_RC=%ERRORLEVEL%"
if not "%TLPRINT_RC%"=="0" echo [NOTE] Read any STOP or WARN messages above. No print jobs or service actions were performed.
if /I not "%TL_PATCH_NO_PAUSE%"=="1" pause
exit /b %TLPRINT_RC%
::TLPRINT_PS_BEGIN
#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ExpectedHost = 'USFTWLDAPP'
$ToolName = 'Truck-Log-Print-ReadOnly-Audit-V1'
$Started = Get-Date
$Downloads = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
if (-not (Test-Path -LiteralPath $Downloads -PathType Container)) {
    throw 'The Downloads folder is unavailable. No report was created.'
}
$Report = Join-Path $Downloads ($ToolName + '-RESULT-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
$Lines = New-Object 'System.Collections.Generic.List[string]'
function Add-Line([string]$Message) {
    $null = $Lines.Add($Message)
    Write-Host $Message
}
function Safe-Name([object]$Value) {
    if ($null -eq $Value) { return '(empty)' }
    $Name = ([string]$Value -replace '[\x00-\x1f\x7f]', ' ').Trim()
    if ($Name.Length -gt 180) { $Name = $Name.Substring(0,180) + ' [truncated]' }
    return $Name
}
function Field($Object,[string]$Name) {
    if ($null -eq $Object) { return $null }
    $Property = $Object.PSObject.Properties[$Name]
    if ($null -eq $Property) { return $null }
    return $Property.Value
}
function ExistsAtRoot([string]$Folder,[string]$File) {
    if ([string]::IsNullOrWhiteSpace($Folder)) { return 'UNKNOWN' }
    try {
        $candidate = Join-Path -Path $Folder -ChildPath $File
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {return 'YES'}
        return 'NO'
    } catch { return 'UNKNOWN' }
}
function ServiceFolder($Service) {
    $Raw = [string](Field $Service 'PathName')
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
    $Exe = $null
    if ($Raw -match '^\s*"([^"\r\n]+?\.exe)"(?:\s|$)') { $Exe = $Matches[1] }
    elseif ($Raw -match '^\s*(.+?\.exe)(?:\s|$)') { $Exe = $Matches[1] }
    if ([string]::IsNullOrWhiteSpace($Exe)) { return $null }
    try { return [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Exe)) }
    catch { return $null }
}
$ExitCode = 0
try {
    Add-Line 'TRUCK LOG PRINT AGENT - READ-ONLY HOST AUDIT V1'
    Add-Line 'Only Get-CimInstance, Get-Service, Get-Printer, Test-Path, and local config gate names are read.'
    Add-Line 'No print jobs, test sheets, restarts, account edits, spooler clearing, or API/DB connections.'
    Add-Line ('Inspection UTC: ' + $Started.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
    Add-Line ('Host: ' + (Safe-Name $env:COMPUTERNAME))
    Add-Line ('Expected dedicated print host: ' + $ExpectedHost)
    Add-Line ''
    if ([string]$env:COMPUTERNAME -ine $ExpectedHost) {
        Add-Line '[STOP] This is not the dedicated Truck Log print PC. No service or printer inspection performed.'
        Add-Line 'Run this CMD locally on the print PC USFTWLDAPP (not the Truck Log source workstation).'
        $ExitCode = 2
    } else {
        Add-Line '[1/4] Windows service and spooler state'
        $Svc = $null
        try { $Svc = Get-CimInstance -ClassName Win32_Service -Filter "Name='TruckLogPrintAgent'" -ErrorAction Stop }
        catch { Add-Line '[WARN] Unable to query TruckLogPrintAgent service via CIM.' }
        if ($null -eq $Svc) {
            Add-Line '[ATTENTION] TruckLogPrintAgent was not found. Do not reinstall until the deployed setup is reviewed.'
        } else {
            Add-Line ('Print Agent present: YES')
            Add-Line ('Service state: ' + (Safe-Name (Field $Svc 'State')))
            Add-Line ('Service startup: ' + (Safe-Name (Field $Svc 'StartMode')))
            $Account = [string](Field $Svc 'StartName')
            Add-Line ('Running as LocalSystem: ' + $(if($Account -in @('LocalSystem','Local System','NT AUTHORITY\\SYSTEM')) {'YES'} else {'NO - REVIEW'}))
        }
        try {
            $Spool = Get-Service -Name 'Spooler' -ErrorAction Stop
            Add-Line ('Windows Print Spooler state: ' + [string]$Spool.Status)
        } catch { Add-Line '[WARN] Print Spooler status unavailable.' }
        Add-Line ''
        Add-Line '[2/4] Agent installed-file presence (no config or credential contents printed)'
        $Folder = ServiceFolder $Svc
        if ($null -eq $Folder) {
            Add-Line '[WARN] Could not identify the installed agent directory from its service entry.'
        } else {
            Add-Line ('SumatraPDF.exe present beside service: ' + (ExistsAtRoot $Folder 'SumatraPDF.exe'))
            Add-Line ('agent.cjs present beside service: ' + (ExistsAtRoot $Folder 'agent.cjs'))
            Add-Line ('core.cjs present beside service: ' + (ExistsAtRoot $Folder 'core.cjs'))
            Add-Line ('manifest.json present beside service: ' + (ExistsAtRoot $Folder 'manifest.json'))
            Add-Line ('config.json present beside service: ' + (ExistsAtRoot $Folder 'config.json'))
            Add-Line ('Encrypted credential file present: ' + (ExistsAtRoot (Join-Path $Folder 'data') 'credential.dpapi'))
        }
        Add-Line ''
        Add-Line '[3/4] Printer routing definitions (read-only local configuration)'
        $RequiredPrinters = @()
        if ($null -ne $Folder -and (Test-Path -LiteralPath (Join-Path $Folder 'config.json') -PathType Leaf)) {
            try {
                $Cfg = Get-Content -LiteralPath (Join-Path $Folder 'config.json') -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
                $Definitions = @((Field $Cfg 'printers'))
                if ($Definitions.Count -eq 1 -and $Definitions[0] -is [array]) { $Definitions = @($Definitions[0]) }
                foreach ($Def in $Definitions) {
                    if ($null -eq $Def) { continue }
                    $Gate = [string](Field $Def 'gate')
                    $Printer = [string](Field $Def 'printer')
                    if (($Gate -eq 'EAST' -or $Gate -eq 'WEST') -and -not [string]::IsNullOrWhiteSpace($Printer)) {
                        $RequiredPrinters += [pscustomobject]@{Gate=$Gate;Printer=$Printer}
                    }
                }
                Add-Line ('Valid-looking East/West definitions: ' + $RequiredPrinters.Count + ' (expected 2)')
                foreach ($D in $RequiredPrinters) {
                    Add-Line ('Configured ' + $D.Gate + ' printer: ' + (Safe-Name $D.Printer))
                }
                if ($RequiredPrinters.Count -eq 2 -and $RequiredPrinters[0].Printer -ieq $RequiredPrinters[1].Printer) {
                    Add-Line '[ATTENTION] EAST and WEST must not resolve to the same printer.'
                }
            } catch {
                Add-Line '[WARN] Configured gate printer names could not be read. No configuration was changed.'
            }
        } else {
            Add-Line '[WARN] Gate routing file not found in the detected agent installation folder.'
        }
        Add-Line ''
        Add-Line '[4/4] Printer queues visible to this Windows login'
        $Queues = @()
        try {
            $Queues = @(Get-Printer -ErrorAction Stop)
            Add-Line ('Printer queues visible: ' + $Queues.Count)
            foreach ($D in $RequiredPrinters) {
                $Matches = @($Queues | Where-Object { [string](Field $_ 'Name') -ieq [string]$D.Printer })
                Add-Line ('Configured ' + $D.Gate + ' printer visible by exact name: ' + $(if ($Matches.Count -eq 1) {'YES'} else {'NO/NOT-MAPPED-IN-THIS-LOGIN'}))
                if ($Matches.Count -eq 1) {
                    Add-Line ('  Queue status: ' + (Safe-Name (Field $Matches[0] 'PrinterStatus')))
                    Add-Line ('  Driver name: ' + (Safe-Name (Field $Matches[0] 'DriverName')))
                }
            }
            Add-Line 'Note: Get-Printer runs as this logged-in user; the agent itself runs under LocalSystem.'
            Add-Line 'A visible queue here does NOT prove the service computer account has print permission.'
        } catch {
            Add-Line '[WARN] Windows printer queue inventory is unavailable to the current login.'
        }
        Add-Line ''
        Add-Line 'Printing remains UNVERIFIED until an authorized office test confirms physical paper output.'
        Add-Line 'Do not repeat a Check-In or print request to diagnose an uncertain existing print job.'
        Add-Line 'FINAL SUMMARY - READ-ONLY AUDIT COMPLETE. NO JOBS SUBMITTED.'
    }
} catch {
    Add-Line '[FAIL] Unexpected inspection error. No printing or service changes were attempted.'
    $ExitCode = 1
} finally {
    try {
        [IO.File]::WriteAllLines($Report, $Lines.ToArray(), (New-Object Text.UTF8Encoding($false)))
        Write-Host ('RESULT: ' + $Report)
    } catch {
        Write-Host '[FAIL] Could not save the local inspection report.'
        $ExitCode = 1
    }
}
exit $ExitCode

::TLPRINT_PS_END
