# Read-only source recovery of the installed original V3 SAP capture watcher.
# Creates an archive alongside this script; never modifies/deletes the installed source.
[CmdletBinding()]
param(
  [string]$SourcePath = 'C:\Temp\Truck-Log-Dedicated-Print-PC-V3\Truck-Log-Dedicated-Print-PC-V3',
  [string]$OutputDirectory = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
  throw "Original V3 source folder not found: $SourcePath. Supply -SourcePath to the correct installed source folder."
}
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
  [void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $env:TEMP ('TruckLogSAPV3Source-' + [guid]::NewGuid().ToString('N'))
$dest = Join-Path $OutputDirectory ("Truck-Log-SAP-Original-V3-Recovered-{0}.zip" -f $stamp)
$excludeDirectories = @('.venv', '__pycache__', '.git', 'Incoming', 'Ready', 'NeedsReview', 'CaptureStaging', 'logs', 'data', 'cache', 'backups')
$includeExtensions = @('.py', '.ps1', '.cmd', '.bat', '.ini', '.md', '.txt', '.toml', '.json', '.yml', '.yaml', '.cfg')
try {
  [void](New-Item -ItemType Directory -Path $stage -Force)
  $root = (Resolve-Path -LiteralPath $SourcePath).Path.TrimEnd('\')
  $count = 0
  foreach ($item in (Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction Stop)) {
    $relative = $item.FullName.Substring($root.Length).TrimStart('\')
    $parts = $relative -split '\\'
    if (@($parts | Where-Object { $excludeDirectories -contains $_ }).Count -gt 0) { continue }
    if ($includeExtensions -notcontains $item.Extension.ToLowerInvariant()) { continue }
    if ($relative -match '(?i)(^|[\\\/])(secret|credential|token|password|private-key|\.env)([.\\\/]|$)') { continue }
    $target = Join-Path $stage $relative
    $targetParent = Split-Path -Parent $target
    [void](New-Item -ItemType Directory -Path $targetParent -Force)
    Copy-Item -LiteralPath $item.FullName -Destination $target -ErrorAction Stop
    $count++
  }
  if ($count -eq 0) { throw 'No original V3 scripts/configuration found. Nothing archived.' }
  @"
Recovered from $root on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz').
Files: $count. Historical source only; not a deployed/restored service.
Files with extensions other than script/config and data documents were excluded.
INI files may contain private settings; keep this ZIP private.
"@ | Set-Content -LiteralPath (Join-Path $stage 'RECOVERY-NOTES.txt') -Encoding UTF8
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $dest -CompressionLevel Optimal -Force -ErrorAction Stop
  $hash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
  Write-Host ("[PASS] Recovered original V3 scripts: {0} files" -f $count)
  Write-Host ("[ZIP] {0}" -f $dest)
  Write-Host ("[SHA256] {0}" -f $hash)
  Write-Warning 'This ZIP may contain local printer settings; do not publish it. Does not include captured PDF documents or credentials by filename.'
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
