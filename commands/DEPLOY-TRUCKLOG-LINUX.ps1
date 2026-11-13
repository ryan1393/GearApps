[CmdletBinding()]
param(
    [string]$OldEnv,
    [string]$Server,
    [string]$AppFolder
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$script:Redactions = @()
$script:RawSecretValues = @{}
$script:NativeExitCode = 1
$script:VerifiedBootstrapHash = $null
$UploadDirectory = $null

function Read-DeployEnvironment([string]$File) {
    $map = @{}
    $script:RawSecretValues = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($File)) {
        $text = $line.Trim()
        if (-not $text -or $text.StartsWith('#')) { continue }
        if ($text -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { throw 'The selected .env has unsupported syntax. Choose the old working Truck Log .env.' }
        $key = $Matches[1]; $raw = $Matches[2].Trim(); $value = $raw
        if ($map.ContainsKey($key)) { throw "Duplicate .env key: $key" }
        if ($raw.StartsWith('"')) {
            if ($raw -notmatch '^"((?:\\.|[^"\\])*)"\s*(?:#.*)?$') { throw "Invalid quoted .env value for $key" }
            $value = $Matches[1]
        } elseif ($raw.StartsWith("'")) {
            if ($raw -notmatch "^'([^']*)'\s*(?:#.*)?$") { throw "Invalid quoted .env value for $key" }
            $value = $Matches[1]
        } else { $value = ($raw -replace '\s+#.*$', '').Trim() }
        $script:RawSecretValues[$key] = $raw
        $map[$key] = $value
    }
    foreach ($key in @('TRUCK_LOG_DATABASE_USERNAME', 'TRUCK_LOG_DATABASE_PASSWORD', 'TRUCK_LOG_DATABASE_NAME')) {
        if (-not $map.ContainsKey($key) -or -not $map[$key].Trim()) { throw "The working .env must contain $key. No database password will be generated." }
    }
    if ($map['TRUCK_LOG_DATABASE_PASSWORD'] -match '^(CHANGE_ME|api)$') { throw 'Choose the old working .env, not a template database password.' }
    return $map
}
function Set-DeployRedactions([hashtable]$Map) {
    $values = New-Object System.Collections.Generic.List[string]
    foreach ($key in $Map.Keys) {
        if ($key -notmatch '(PASSWORD|SECRET|TOKEN|PROXY_KEY|API_KEY|PRIVATE_KEY|RXO_.*USERNAME|SMTP_.*USER)') { continue }
        $value = [string]$Map[$key]
        if (-not $value) { continue }
        $decoded = $value.Replace('\n', "`n").Replace('\r', "`r").Replace('\t', "`t").Replace('\"', '"').Replace('\\', '\')
        $expanded = $decoded.Replace('$$', '$')
        $raw = if ($script:RawSecretValues.ContainsKey($key)) { $script:RawSecretValues[$key] } else { $value }
        foreach ($form in @($value, $raw, $decoded, $expanded)) {
            if (-not $form) { continue }
            $values.Add($form)
            $values.Add([Uri]::EscapeDataString($form))
            $values.Add([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($form)))
            foreach ($part in ($form -split '[\r\n]+')) { if ($part) { $values.Add($part) } }
            $encoded = ConvertTo-Json -InputObject $form -Compress
            if ($encoded.Length -gt 2) { $values.Add($encoded.Substring(1, $encoded.Length - 2)) }
        }
    }
    $script:Redactions = @($values | Sort-Object -Unique -CaseSensitive | Sort-Object -Property Length -Descending)
}
function Protect-DeployOutput([string]$Text) {
    foreach ($value in $script:Redactions) { $Text = $Text.Replace($value, '[REDACTED]') }
    return $Text
}
function Invoke-DeployNative {
    param([string]$Executable, [string[]]$CommandArguments, [string]$Operation, [switch]$Capture, [string]$InputText)
    Write-Host ("`n==> " + $Operation) -ForegroundColor Cyan
    $output = New-Object System.Collections.Generic.List[string]
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        # Displayed native output is redacted. Captured stdout is machine data
        # kept internal and is never displayed without redaction.
        # Nothing in this pipeline invokes another native command: LASTEXITCODE
        # therefore still belongs to ssh/scp/docker, even when stderr is present.
        $emitLine = {
            if ($Capture -and $_ -isnot [System.Management.Automation.ErrorRecord]) {
                # Machine data remains internal: redaction must not alter an
                # SSH account/context used to form the actual connection.
                $output.Add([string]$_)
            } else { Write-Host (Protect-DeployOutput ([string]$_)) }
        }
        if ($PSBoundParameters.ContainsKey('InputText')) {
            # Fixed ASCII shell text travels as stdin, never as a quoted native
            # argument. This survives Windows PowerShell 5.1 legacy quoting.
            $InputText | & $Executable @CommandArguments 2>&1 | ForEach-Object $emitLine
        } else {
            & $Executable @CommandArguments 2>&1 | ForEach-Object $emitLine
        }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    $script:NativeExitCode = $code
    if ($code -ne 0) { throw "$Operation failed (exit $code). The redacted error is shown above; no Docker volumes were removed." }
    if ($Capture) { return $output.ToArray() }
}
function Select-DeployEnvironment {
    if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Run DEPLOY-TRUCKLOG-LINUX.cmd, or provide -OldEnv with the working .env path.' }
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    try {
        $dialog.Title = 'Choose the OLD WORKING Truck Log .env'
        $dialog.Filter = 'Truck Log environment (.env)|.env|All files (*.*)|*.*'
        $dialog.CheckFileExists = $true; $dialog.Multiselect = $false; $dialog.RestoreDirectory = $true
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'No .env selected. Nothing was uploaded.' }
        return $dialog.FileName
    } finally { $dialog.Dispose() }
}
function Resolve-DeployRepository {
    $start = if ($AppFolder) { $AppFolder } elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'SHA256SUMS.txt')) { $PSScriptRoot } else { (Get-Location).Path }
    $folder = Get-Item -LiteralPath (Resolve-Path -LiteralPath $start).Path -Force
    for ($depth = 0; $depth -lt 5 -and $null -ne $folder; $depth++) {
        if ((Test-Path -LiteralPath (Join-Path $folder.FullName 'SHA256SUMS.txt') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $folder.FullName 'truck-log\VERSION') -PathType Leaf)) { return $folder.FullName }
        $folder = $folder.Parent
    }
    throw 'Use the complete release folder containing SHA256SUMS.txt and truck-log, or provide -AppFolder.'
}
function Get-DeployTarget([string]$Address) {
    if ($Address -notmatch '^ssh://') { $Address = 'ssh://' + $Address }
    $uri = $null
    if (-not [Uri]::TryCreate($Address, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'ssh' -or $uri.Query -or $uri.Fragment) { throw 'SSH target must be user@host or ssh://user@host:port.' }
    $hostName = $uri.DnsSafeHost
    if ($hostName -notmatch '^[A-Za-z0-9][A-Za-z0-9.:-]*$') { throw 'SSH host name is invalid.' }
    $user = [Uri]::UnescapeDataString($uri.UserInfo)
    if ($user -and $user -notmatch '^[A-Za-z_][A-Za-z0-9_.-]*\$?$') { throw 'SSH target must use a login name without a password or shell options.' }
    if ($uri.AbsolutePath -and $uri.AbsolutePath -ne '/') { throw 'SSH target must not contain a path.' }
    $displayHost = if ($hostName.Contains(':')) { '[' + $hostName + ']' } else { $hostName }
    $target = if ($user) { $user + '@' + $displayHost } else { $displayHost }
    return [pscustomobject]@{ Target = $target; Port = $uri.Port }
}
function New-DeployArchive([string]$Repository, [string]$ArchivePath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $entries = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    foreach ($line in [System.IO.File]::ReadAllLines((Join-Path $Repository 'SHA256SUMS.txt'))) {
        if (-not $line.Trim()) { continue }
        if ($line -notmatch '^([0-9a-fA-F]{64})  (.+)$') { throw 'The release SHA256SUMS.txt has an invalid entry.' }
        $expected = $Matches[1]; $relative = $Matches[2]
        $parts = $relative.Split('/')
        if ($relative -match '[:\\]' -or $relative.StartsWith('/') -or $parts -contains '..' -or $parts -contains '.' -or $parts -contains '' -or $seen.ContainsKey($relative)) { throw 'The release manifest contains an unsafe or duplicate path.' }
        foreach ($part in $parts) {
            if ($part -imatch '^(\.git|node_modules|\.setup-backups|\.runtime-logs|\.new-host-state|\.secrets|_patch_backups|patch_backups|backups)$' -or
                ($part -imatch '^\.env(?:\.|$)' -and $part -ine '.env.example')) { throw 'The release manifest includes a private or runtime file. Nothing was uploaded.' }
        }
        $full = Join-Path $Repository $relative
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('A release file is missing: ' + $relative) }
        if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ine $expected) { throw ('A release file failed SHA-256 verification: ' + $relative + '. Use a freshly extracted complete ZIP.') }
        if ($relative -ceq 'DEPLOY-TRUCKLOG-LINUX.py') { $script:VerifiedBootstrapHash = $expected }
        $seen[$relative] = $true
        $entries.Add([pscustomobject]@{ Full = $full; Relative = $relative })
    }
    foreach ($required in @('truck-log/VERSION', 'truck-log/SETUP-TRUCK-LOG.sh', 'truck-log/MANIFEST-SHA256.txt', 'DEPLOY-TRUCKLOG-LINUX.py')) {
        if (-not $seen.ContainsKey($required)) { throw "The complete release manifest is missing $required." }
    }
    $stream = [System.IO.File]::Open($ArchivePath, [System.IO.FileMode]::CreateNew)
    $archive = $null
    try {
        $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
        foreach ($entry in $entries) { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $entry.Full, $entry.Relative) | Out-Null }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $Repository 'SHA256SUMS.txt'), 'SHA256SUMS.txt') | Out-Null
    } finally { if ($archive) { $archive.Dispose() } else { $stream.Dispose() } }
}

try {
    $Repository = Resolve-DeployRepository
    $app = Join-Path $Repository 'truck-log'
    if (-not $OldEnv) {
        $current = Join-Path $app '.env'
        $OldEnv = if (Test-Path -LiteralPath $current -PathType Leaf) { $current } else { Select-DeployEnvironment }
    }
    $source = Get-Item -LiteralPath (Resolve-Path -LiteralPath $OldEnv).Path -Force
    if ($source.PSIsContainer -or $source.Name -ine '.env' -or $source.Length -eq 0) { throw 'Choose a nonempty working file named .env, not .env.example.' }
    # Snapshot once: later edits to the original cannot invalidate redaction or
    # change the credentials uploaded after package verification.
    $token = [guid]::NewGuid().ToString('N')
    $UploadDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('TruckLog-upload-' + $token)
    New-Item -ItemType Directory -Path $UploadDirectory | Out-Null
    $EnvSnapshot = Join-Path $UploadDirectory 'old.env'
    Copy-Item -LiteralPath $source.FullName -Destination $EnvSnapshot -Force
    $map = Read-DeployEnvironment $EnvSnapshot
    Set-DeployRedactions $map
    $SshExe = (Get-Command ssh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $ScpExe = (Get-Command scp -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    if (-not $Server) {
        $DockerExe = (Get-Command docker -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        $contextName = (@(Invoke-DeployNative -Executable $DockerExe -CommandArguments @('context', 'show') -Operation 'Reading the current Docker context' -Capture) -join '').Trim()
        Write-Host (Protect-DeployOutput ('Current Docker context: ' + $contextName + ' (unchanged)'))
        if ($env:DOCKER_CONTEXT -or -not $env:DOCKER_HOST) {
            $endpointJson = (@(Invoke-DeployNative -Executable $DockerExe -CommandArguments @('context', 'inspect', $contextName, '--format', '{{json .Endpoints.docker.Host}}') -Operation 'Reading its SSH endpoint' -Capture) -join '').Trim()
            $Server = ConvertFrom-Json -InputObject $endpointJson
        } else { $Server = $env:DOCKER_HOST }
        if ($Server -notmatch '^ssh://') { throw 'This Docker connection does not use SSH. Run again with -Server user@linux-host.' }
    }
    $target = Get-DeployTarget $Server
    $sshOptions = @('-o', 'ConnectTimeout=20'); $scpOptions = @('-o', 'ConnectTimeout=20')
    if ($target.Port -gt 0) { $sshOptions += @('-p', [string]$target.Port); $scpOptions += @('-P', [string]$target.Port) }
    $remote = 'truck-log-releases/' + $token
    $ArchivePath = Join-Path $UploadDirectory 'TruckLog.zip'
    Write-Host 'Verifying the complete release and preparing a clean ZIP (local .env and Git/build folders are excluded).'
    New-DeployArchive $Repository $ArchivePath
    $BootstrapPath = Join-Path $UploadDirectory 'DEPLOY-TRUCKLOG-LINUX.py'
    Copy-Item -LiteralPath (Join-Path $Repository 'DEPLOY-TRUCKLOG-LINUX.py') -Destination $BootstrapPath -Force
    if ((Get-FileHash -LiteralPath $BootstrapPath -Algorithm SHA256).Hash -ine $script:VerifiedBootstrapHash) { throw 'The Linux deploy helper changed during package preparation. Use a freshly extracted complete release.' }
    $ArchiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host (Protect-DeployOutput ('Linux SSH target: ' + $target.Target))
    Write-Host ('Private remote release folder: ~/' + $remote)
    $prepare = 'umask 077; command -v python3 >/dev/null 2>&1 || { printf "%s\n" "Python 3 is required on the Linux server." >&2; exit 127; }; d="$HOME/__STAGE__"; mkdir -p -- "$d" && chmod 700 -- "$d"'
    # The trailing comment consumes PowerShell's final CR in a CRLF stdin line.
    $prepare = $prepare.Replace('__STAGE__', $remote) + ' # end'
    Invoke-DeployNative -Executable $SshExe -CommandArguments ($sshOptions + @('--', $target.Target, 'sh', '-s')) -InputText $prepare -Operation 'Preparing a private release directory on Linux'
    $remotePrefix = $target.Target + ':' + $remote + '/'
    # Relative local paths avoid Windows drive-colon ambiguity in scp variants.
    Push-Location $UploadDirectory
    try {
        Invoke-DeployNative -Executable $ScpExe -CommandArguments ($scpOptions + @('--', './TruckLog.zip', ($remotePrefix + 'TruckLog.zip'))) -Operation 'Uploading the verified application ZIP'
        Invoke-DeployNative -Executable $ScpExe -CommandArguments ($scpOptions + @('--', './old.env', ($remotePrefix + 'old.env'))) -Operation 'Uploading the saved environment separately'
        Invoke-DeployNative -Executable $ScpExe -CommandArguments ($scpOptions + @('--', './DEPLOY-TRUCKLOG-LINUX.py', ($remotePrefix + 'DEPLOY-TRUCKLOG-LINUX.py'))) -Operation 'Uploading the verified Linux deploy helper'
    } finally { Pop-Location }
    $run = 'd="$HOME/__STAGE__"; chmod 600 -- "$d/old.env" && python3 "$d/DEPLOY-TRUCKLOG-LINUX.py" --archive "$d/TruckLog.zip" --env-file "$d/old.env" --sha256 ''__HASH__'''
    $run = $run.Replace('__STAGE__', $remote).Replace('__HASH__', $ArchiveHash) + ' # end'
    Invoke-DeployNative -Executable $SshExe -CommandArguments ($sshOptions + @('--', $target.Target, 'sh', '-s')) -InputText $run -Operation 'Building and starting Truck Log directly on the Linux server'
    Write-Host ''
    Write-Host 'Linux deployment completed. The old local .env was not changed; existing database volumes and administrator accounts were reused.' -ForegroundColor Green
    Write-Host ('Redacted server log: ~/' + $remote + '/deploy.log')
} catch {
    Write-Host ('DEPLOY STOPPED: ' + (Protect-DeployOutput $_.Exception.Message)) -ForegroundColor Red
    Write-Host 'No Docker volumes were deleted. The old local .env was left unchanged.'
    $exitCode = if ($script:NativeExitCode -gt 0) { $script:NativeExitCode } else { 1 }
    exit $exitCode
} finally {
    if ($UploadDirectory -and (Test-Path -LiteralPath $UploadDirectory)) { Remove-Item -LiteralPath $UploadDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}
