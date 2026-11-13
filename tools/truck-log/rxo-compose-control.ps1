[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('start','status','logs')]
    [string]$Action
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker.exe was not found.' }
. (Join-Path $PSScriptRoot 'compose-common.ps1')
Resolve-TruckLogCompose
switch ($Action) {
    'start' {
        Invoke-TruckLogCompose -CommandArgs @('up','-d','--build','rxo-export') | Out-Null
        Invoke-TruckLogCompose -CommandArgs @('ps','rxo-export') | Out-Null
    }
    'status' {
        Invoke-TruckLogCompose -CommandArgs @('ps','rxo-export') | Out-Null
        Invoke-TruckLogCompose -CommandArgs @('logs','--tail=80','rxo-export') | Out-Null
    }
    'logs' {
        Invoke-TruckLogCompose -CommandArgs @('logs','-f','rxo-export') | Out-Null
    }
}
