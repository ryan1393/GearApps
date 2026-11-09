[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('start','stop','status','logs')]
    [string]$Action
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker.exe was not found.' }
. (Join-Path $PSScriptRoot 'compose-common.ps1')
Resolve-TruckLogCompose

if ($Action -eq 'start') { Assert-NoForeignTruckLogResources }

switch ($Action) {
    'start'  { Invoke-TruckLogCompose -CommandArgs @('up','-d') | Out-Null; Write-Host 'Truck Log services started.' -ForegroundColor Green }
    'stop'   { Invoke-TruckLogCompose -CommandArgs @('stop') | Out-Null; Write-Host 'Truck Log services stopped. Persistent volumes were preserved.' -ForegroundColor Green }
    'status' { Invoke-TruckLogCompose -CommandArgs @('ps') | Out-Null }
    'logs'   { Invoke-TruckLogCompose -CommandArgs @('logs','--tail=250','-f') | Out-Null }
}
