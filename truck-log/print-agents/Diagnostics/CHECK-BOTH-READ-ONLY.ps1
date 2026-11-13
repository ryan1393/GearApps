# On USFTWLDAPP. Reads agent, service, queue, capture and V3 package state.
# Does not submit paper, stop/start services, access credentials or modify the host.
$ErrorActionPreference='Continue'
Write-Host 'TRUCK LOG TWO PRINT COMPONENTS - READ-ONLY CHECK'
Write-Host ('Host: '+$env:COMPUTERNAME+'  Time: '+(Get-Date))
Write-Host 'No changes or print submissions will be made.'
Write-Host ''
foreach ($name in @('Spooler','TruckLogPrintAgent','TruckLogPackingSlipWatcher','PDF24')) {
  $svc=Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($svc) { Write-Host ('SERVICE '+$name+': '+$svc.Status+' / '+$svc.StartType) }
  else { Write-Warning ('SERVICE '+$name+' not found') }
}
$guard = Join-Path $env:ProgramData 'Dana\TruckLogPrintAgent'
Write-Host ('Guard agent folder: '+$guard)
foreach ($name in @('agent.cjs','core.cjs','config.json','manifest.json','SumatraPDF.exe','TruckLogPrintAgent.exe')) {
  Write-Host ('  '+$name+': '+(Test-Path -LiteralPath (Join-Path $guard $name) -PathType Leaf))
}
$printerNames=@('\\USFTWPLVPS03\USFTWP_E_Gate_Pass', '\\USFTWPLVPS03\USFTWP_W_Gate_Pass', 'DGL TEST')
try {
  Import-Module PrintManagement -ErrorAction Stop
  foreach ($name in $printerNames) {
    try { $p=Get-Printer -Name $name -ErrorAction Stop; Write-Host ('QUEUE '+$name+': '+$p.PrinterStatus+' Shared='+$p.Shared) }
    catch { Write-Warning ('QUEUE '+$name+' not available to this account') }
  }
} catch { Write-Warning 'Cannot read PrintManagement printer inventory.' }
$orig='C:\Temp\Truck-Log-Dedicated-Print-PC-V3\Truck-Log-Dedicated-Print-PC-V3'
Write-Host ('SAP V3 source found: '+(Test-Path -LiteralPath $orig -PathType Container)+' ('+$orig+')')
for ($i=1;$i -le 8;$i++) {
  $p="C:\TruckLog\CaptureStaging\route$i\capture.pdf"
  Write-Host ("  Capture route$i staging file exists: "+(Test-Path -LiteralPath $p -PathType Leaf))
}
try {
  $tasks=Get-ScheduledTask -ErrorAction Stop | Where-Object {
    ($_.TaskName -match 'SAP|Capture|TruckLog') -or ((@($_.Actions) | ForEach-Object { $_.Execute+' '+$_.Arguments }) -join ' ' -match 'truck_log_print_server|sap_capture_watcher|Truck-Log-SAP-Capture')
  }
  if ($tasks) { $tasks | Select-Object TaskName,State | Format-Table -AutoSize }
  else { Write-Warning 'No SAP/Truck Log capture startup task discovered by name or action.' }
} catch { Write-Warning 'Cannot read scheduled-task inventory.' }
Write-Host 'CHECK COMPLETE - verify service access and paper separately.'
