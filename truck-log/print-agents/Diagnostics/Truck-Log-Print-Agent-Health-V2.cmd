@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Truck Log - Print Agent Read-Only Health V2
set "TLPRINTV2_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';try{$s=[IO.File]::ReadAllText($env:TLPRINTV2_SELF);$a='::'+'TLPRINTV2_PS_BEGIN';$b='::'+'TLPRINTV2_PS_END';$i=$s.IndexOf($a,[StringComparison]::Ordinal);$j=$s.IndexOf($b,[StringComparison]::Ordinal);if($i -lt 0 -or $j -le $i){throw 'Embedded script missing'};$v=$s.Substring($i+$a.Length,$j-$i-$a.Length);$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseInput($v,[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{Write-Host ('[FAIL] Parser: '+$_.Message)};exit 1};Write-Host '[PASS] PowerShell parser gate';&([ScriptBlock]::Create($v))}catch{Write-Host '[FAIL] Read-only health check could not run.';exit 1}"
set "TLPRINTV2_RC=%ERRORLEVEL%"
if /I not "%TL_PATCH_NO_PAUSE%"=="1" pause
exit /b %TLPRINTV2_RC%
::TLPRINTV2_PS_BEGIN
#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ExpectedHost='USFTWLDAPP'
$Name='Truck-Log-Print-Agent-Health-V2'
$Date=Get-Date
$Lines=New-Object 'System.Collections.Generic.List[string]'
function Add([string]$S){[void]$Lines.Add($S);Write-Host $S}
function F($Obj,[string]$Prop){if($null -eq $Obj){return $null};$p=$Obj.PSObject.Properties[$Prop];if($null -eq $p){return $null};return $p.Value}
function ReadJson([string]$Root,[string]$Leaf){
  try{
    $p=Join-Path $Root $Leaf
    if(-not (Test-Path -LiteralPath $p -PathType Leaf)){return $null}
    $fi=Get-Item -LiteralPath $p -ErrorAction Stop
    if($fi.Length -gt 524288 -or (($fi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){return $null}
    return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
  }catch{return $null}
}
function Bool($x){if($x -eq $true){return 'YES'};if($x -eq $false){return 'NO'};return 'UNKNOWN'}
function AgentRoot($service){
  $raw=[string](F $service 'PathName')
  if($raw -match '^\s*"([^"\r\n]+?\.exe)"(?:\s|$)'){$p=$Matches[1]}
  elseif($raw -match '^\s*(.+?\.exe)(?:\s|$)'){$p=$Matches[1]}
  else{return $null}
  try{return [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($p))}catch{return $null}
}
function Classify([string]$s){
  if($s -match '(?i)Win32\s*5|access\s*denied|printer\s*not\s*accessible|permission\s*denied'){return 'PRINTER_ACCESS_DENIED'}
  if($s -match '(?i)REVIEW|409|could\s*not\s*be\s*finalized|uncertain\s*print'){return 'PRINT_REVIEW_OR_UNCERTAIN'}
  if($s -match '(?i)spool|printer\s*not\s*found|queue\s*not\s*found|printer\s*offline'){return 'PRINTER_OR_SPOOLER'}
  if($s -match '(?i)token|401|403|authentication|authorization|heartbeat|server\s*request|API\s*request'){return 'AGENT_API_OR_AUTH'}
  if($s -match '(?i)error|fail|timeout|exception|refused|invalid'){return 'OTHER_AGENT_ERROR'}
  return 'OTHER_LOG_MESSAGE'
}
$D=Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
if(-not (Test-Path -LiteralPath $D -PathType Container)){throw 'Downloads unavailable; no report created.'}
$Report=Join-Path $D ($Name+'-RESULT-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.txt')
$Exit=0
try{
 Add 'TRUCK LOG - PRINT AGENT READ-ONLY HEALTH CHECK V2'
 Add 'Reads only service metadata, allowlisted readiness JSON, manifest hashes and classified log timestamps.'
 Add 'No print jobs, test sheets, printer permissions, service starts/stops, task creation or API/DB calls.'
 Add ('Time UTC: '+[DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))
 Add ('Host: '+$env:COMPUTERNAME)
 if($env:COMPUTERNAME -ine $ExpectedHost){
   Add '[STOP] This CMD must run locally on USFTWLDAPP. No service data inspected.';$Exit=2
 }else{
   $svc=$null
   try{$svc=Get-CimInstance Win32_Service -Filter "Name='TruckLogPrintAgent'" -ErrorAction Stop}catch{Add '[WARN] Print Agent service lookup failed.'}
   if($null -eq $svc){Add '[STOP] Print Agent service not found; no changes attempted.';$Exit=3}
   else{
     Add ('Service: '+[string](F $svc 'State')+'; startup='+[string](F $svc 'StartMode'))
     $account=[string](F $svc 'StartName')
     Add ('Service LocalSystem: '+$(if($account -in @('LocalSystem','Local System','NT AUTHORITY\SYSTEM')){'YES'}else{'NO/UNKNOWN'}))
     $root=AgentRoot $svc
     if($null -eq $root){Add '[WARN] Agent installation folder not determined.'}
     else{
       $data=Join-Path $root 'data'
       $cfg=ReadJson $root 'config.json'
       $ready=ReadJson $data 'ready.json'
       $active=ReadJson $data 'activation.json'
       $poll=ReadJson $data 'enable-polling.json'
       Add '[1/3] Local readiness (no credentials exported)'
       Add ('Ready state: '+$(if($null -ne $ready){[string](F $ready 'state')}else{'NO_READABLE_READY_RECORD'}))
       Add ('Ready LocalSystem SID: '+$(if([string](F $ready 'identitySid') -eq 'S-1-5-18'){'YES'}else{'NO/UNKNOWN'}))
       $serverAt=[string](F $ready 'serverReceivedAt')
       if($serverAt){
          try{$t=[DateTimeOffset]::Parse($serverAt,[Globalization.CultureInfo]::InvariantCulture);$age=[int]([DateTimeOffset]::UtcNow-$t.ToUniversalTime()).TotalSeconds;Add ('Server-received heartbeat age: '+$age+' seconds'+$(if($age -gt 60){' [STALE]'}else{' [RECENT]'}))}
          catch{Add '[WARN] Heartbeat timestamp not parseable.'}
       }else{Add 'Server-received heartbeat age: UNAVAILABLE'}
       Add ('Server API scopes verified in ready record: '+(Bool (F $ready 'permissionsVerified')))
       $install=[string](F $cfg 'installId')
       $activated=($null -ne $active -and $install -and [string](F $active 'installId') -eq $install -and (F $active 'eastConfirmed') -eq $true -and (F $active 'westConfirmed') -eq $true)
       $enabled=($null -ne $poll -and $install -and [string](F $poll 'installId') -eq $install)
       Add ('EAST/WEST activation matches current installation: '+(Bool $activated))
       Add ('Job polling enabled for this installation: '+(Bool $enabled))
       Add 'Important: ACTIVE/fresh indicates recent successful readiness logic only for a verified matching worker; it is not proof of physical printing.'
       Add '[2/3] Installed worker integrity'
       $manifest=ReadJson $root 'manifest.json'
       $hashes=F $manifest 'hashes'
       foreach($file in @('agent.cjs','core.cjs')){
         $want=[string](F $hashes $file)
         $p=Join-Path $root $file
         if($want -match '^[a-fA-F0-9]{64}$' -and (Test-Path -LiteralPath $p -PathType Leaf)){
           try{ $item=Get-Item -LiteralPath $p -ErrorAction Stop
             if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Add ($file+' manifest hash: LINKED - NOT VERIFIED')}
             else{$actual=(Get-FileHash -LiteralPath $p -Algorithm SHA256 -ErrorAction Stop).Hash;Add ($file+' manifest hash: '+$(if($actual -ieq $want){'MATCH'}else{'MISMATCH'}))}
           }catch{Add ($file+' manifest hash: UNAVAILABLE')}
         }else{Add ($file+' manifest hash: NOT VERIFIED')}
       }
       Add '[3/3] Recent agent log classifications (no raw messages or document names)'
       $log=Join-Path $data 'agent.log'
       if(-not(Test-Path -LiteralPath $log -PathType Leaf)){Add 'Agent log: MISSING/NOT READABLE'}
       else{
         try{
           $item=Get-Item -LiteralPath $log -ErrorAction Stop
           if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Add 'Agent log: LINKED - NOT READ'}
           else{
             $last=@(Get-Content -LiteralPath $log -Tail 500 -Encoding UTF8 -ErrorAction Stop)
             $cut=[DateTimeOffset]::UtcNow.AddHours(-48)
             $counts=@{}; $mostRecent=@{}; $valid=0
             foreach($line in $last){
               if($line -notmatch '^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$'){continue}
               try{$when=[DateTimeOffset]::Parse($Matches[1],[Globalization.CultureInfo]::InvariantCulture)}catch{continue}
               if($when -lt $cut){continue}
               $msg=[string]$Matches[2]
               $cat=Classify $msg
               if($cat -eq 'OTHER_LOG_MESSAGE'){continue}
               $valid++
               if(-not $counts.ContainsKey($cat)){$counts[$cat]=0;$mostRecent[$cat]=$when}
               $counts[$cat]++
               if($when -gt $mostRecent[$cat]){$mostRecent[$cat]=$when}
             }
             Add ('Recent classified errors/warnings: '+$valid+' in last 48 hours of latest 500 log lines')
             foreach($cat in @('PRINTER_ACCESS_DENIED','PRINT_REVIEW_OR_UNCERTAIN','PRINTER_OR_SPOOLER','AGENT_API_OR_AUTH','OTHER_AGENT_ERROR')){
               if($counts.ContainsKey($cat)){Add ('  '+$cat+': '+$counts[$cat]+' latest UTC='+$mostRecent[$cat].UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ'))}
               else{Add ('  '+$cat+': 0 in sampled recent log lines')}
             }
             Add 'No raw agent messages, spool data, credentials or print-job identifiers are collected.'
           }
         }catch{Add '[WARN] Could not read classified agent log timestamps.'}
       }
     }
   }
   Add 'No physical printing certified. Do not retry a held print job or duplicate a visit.'
   Add 'FINAL SUMMARY - READ-ONLY HEALTH CHECK COMPLETE. NO PRINTS SUBMITTED.'
 }
}catch{Add '[FAIL] Inspection ended early; no service/printer writes attempted.';$Exit=1}
finally{
 try{[IO.File]::WriteAllLines($Report,$Lines.ToArray(),(New-Object Text.UTF8Encoding($false)));Write-Host ('RESULT: '+$Report)}
 catch{Write-Host '[FAIL] Report save failed.';$Exit=1}
}
exit $Exit
::TLPRINTV2_PS_END
