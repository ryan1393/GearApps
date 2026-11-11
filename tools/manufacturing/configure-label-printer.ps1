param(
    [string]$HostName,
    [int]$Port = 9100,
    [int]$TimeoutMs = 5000
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $ProjectRoot '.env'

if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
    throw "MeshForge .env was not found at $EnvPath"
}

if (-not $HostName) {
    $HostName = (Read-Host 'IPL label printer IP address or hostname').Trim()
}
if (-not $HostName) { throw 'Printer IP address / hostname is required.' }
if ($HostName -match '[\s;]') { throw 'Printer hostname/IP contains unsupported characters.' }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Printer port must be between 1 and 65535.' }
if ($TimeoutMs -lt 500 -or $TimeoutMs -gt 60000) { throw 'Printer timeout must be between 500 and 60000 milliseconds.' }

function Set-EnvValue([string]$Text, [string]$Name, [string]$Value) {
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'
    $line = "$Name=$Value"
    if ([regex]::IsMatch($Text, $pattern)) {
        return [regex]::Replace($Text, $pattern, $line, 1)
    }
    return $Text.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
}

$text = Get-Content -LiteralPath $EnvPath -Raw
if ($text -notmatch '(?m)^#===== MeshForge IPL serial-tag printer\s*$' -and
    $text -notmatch '(?m)^GEAR_LABEL_PRINTER_HOST=') {
    $text = $text.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + '#===== MeshForge IPL serial-tag printer' + [Environment]::NewLine
}
$text = Set-EnvValue $text 'GEAR_LABEL_PRINTER_HOST' $HostName
$text = Set-EnvValue $text 'GEAR_LABEL_PRINTER_PORT' ([string]$Port)
$text = Set-EnvValue $text 'GEAR_LABEL_PRINTER_TIMEOUT_MS' ([string]$TimeoutMs)
[IO.File]::WriteAllText($EnvPath, $text, [Text.UTF8Encoding]::new($false))

Write-Host ''
Write-Host '[PASS] MeshForge IPL label printer configured.' -ForegroundColor Green
Write-Host "Printer: $HostName`:$Port" -ForegroundColor Cyan
Write-Host 'No label was printed by this configuration command.' -ForegroundColor DarkGray
Write-Host 'Restart commands\START-GEAR-APPS.cmd before using Print Tag.' -ForegroundColor Yellow

