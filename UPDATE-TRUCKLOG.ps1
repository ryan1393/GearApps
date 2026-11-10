[CmdletBinding()]
param(
    [string]$OldEnv
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$AppRoot = Join-Path $PSScriptRoot 'truck-log'
$EnvironmentRestore = @{}
$CopiedEnvironment = $false
$BackupPath = $null

function Read-UpdateEnvironment([string]$Path) {
    $map = @{}
    $lineNumber = 0
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $lineNumber++
        $trim = $line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }
        if ($trim -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            throw "Unsupported .env syntax on line $lineNumber. Choose the old working Truck Log .env."
        }
        $key = $Matches[1]
        $raw = $Matches[2].Trim()
        if ($map.ContainsKey($key)) { throw "Duplicate .env key: $key" }
        $value = $raw
        if ($raw.StartsWith('"')) {
            if ($raw -notmatch '^"((?:\\.|[^"\\])*)"\s*(?:#.*)?$') { throw "Invalid quoted .env value for $key" }
            $value = $Matches[1]
        } elseif ($raw.StartsWith("'")) {
            if ($raw -notmatch "^'([^']*)'\s*(?:#.*)?$") { throw "Invalid quoted .env value for $key" }
            $value = $Matches[1]
        } else {
            $value = ($raw -replace '\s+#.*$', '').Trim()
        }
        $map[$key] = $value
    }
    foreach ($key in @('TRUCK_LOG_DATABASE_USERNAME', 'TRUCK_LOG_DATABASE_PASSWORD', 'TRUCK_LOG_DATABASE_NAME')) {
        if (-not $map.ContainsKey($key) -or -not $map[$key].Trim()) {
            throw "The selected .env is missing $key. It will not be replaced with generated credentials."
        }
    }
    if ($map['TRUCK_LOG_DATABASE_PASSWORD'] -match '^(CHANGE_ME|api)$') {
        throw 'The selected .env contains a template database password. Choose the old working .env; no new database password will be generated.'
    }
    return $map
}

function Invoke-UpdateNative {
    param([string]$FilePath, [string[]]$CommandArguments, [string]$Operation)
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell can represent normal native stderr as error records.
        $ErrorActionPreference = 'Continue'
        # Dotenv/Compose errors can echo secret values. Do not forward raw stderr.
        & $FilePath @CommandArguments 2>$null
        $nativeExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($nativeExitCode -ne 0) { throw "$Operation failed with exit code $nativeExitCode. Your database volumes were not removed." }
}

function Select-OldEnvironment {
    if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
        throw 'Run UPDATE-TRUCKLOG.cmd to open the file picker, or provide -OldEnv with the full old .env path.'
    }
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    try {
        $dialog.Title = 'Choose the OLD WORKING Truck Log .env (keeps your database login)'
        $dialog.Filter = 'Truck Log environment (.env)|.env|All files (*.*)|*.*'
        $dialog.CheckFileExists = $true
        $dialog.CheckPathExists = $true
        $dialog.Multiselect = $false
        $dialog.RestoreDirectory = $true
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'No .env selected. Nothing was changed.' }
        return $dialog.FileName
    } finally { $dialog.Dispose() }
}

function Get-UpdateHealth([string]$ContainerName) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = @(& $DockerExe inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ContainerName 2>$null)
        $nativeExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($nativeExitCode -ne 0) { return 'unavailable' }
    return ([string]($result -join '')).Trim()
}

try {
    $SetupPath = Join-Path $AppRoot 'tools\truck-log\setup-docker.ps1'
    foreach ($file in @($SetupPath, (Join-Path $AppRoot 'VERSION'), (Join-Path $AppRoot 'docker-compose.yml'))) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Keep this updater in the repository folder beside truck-log. The installation files are missing.' }
    }
    $DockerExe = (Get-Command docker -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $PowerShellExe = (Get-Command powershell.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    if (-not $OldEnv) { $OldEnv = Select-OldEnvironment }
    $source = Get-Item -LiteralPath (Resolve-Path -LiteralPath $OldEnv).Path -Force
    if ($source.PSIsContainer -or $source.Name -ine '.env' -or $source.Length -eq 0) {
        throw 'Choose a nonempty file named .env from the OLD working installation, not .env.example or a ZIP.'
    }
    $DestinationEnv = Join-Path $AppRoot '.env'
    if ([string]::Equals($source.FullName, [System.IO.Path]::GetFullPath($DestinationEnv), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Select .env from the OLD working installation, not the destination truck-log folder.'
    }
    $oldMap = Read-UpdateEnvironment $source.FullName
    $PublicOrigin = if ($oldMap.ContainsKey('TRUCK_LOG_PUBLIC_ORIGIN')) { $oldMap['TRUCK_LOG_PUBLIC_ORIGIN'] } else { '' }
    $Transport = if ($oldMap.ContainsKey('TRUCK_LOG_ADMIN_TRANSPORT')) { $oldMap['TRUCK_LOG_ADMIN_TRANSPORT'] } else { '' }
    $UseHttps = $PublicOrigin -match '^https://' -or $Transport -ieq 'https'
    if ($UseHttps) {
        if ($PublicOrigin -notmatch '^https://' -or ($Transport -and $Transport -ine 'https')) {
            throw 'The old .env has inconsistent HTTPS settings. PUBLIC_ORIGIN must use https:// and ADMIN_TRANSPORT must be https (or absent). HTTP will not be started.'
        }
        foreach ($key in @('TRUCK_LOG_TLS_CERT_DIR', 'TRUCK_LOG_ADMIN_PROXY_KEY')) {
            if (-not $oldMap.ContainsKey($key) -or -not $oldMap[$key]) { throw "HTTPS needs $key in the old working .env. HTTP will not be started." }
        }
        if ($oldMap['TRUCK_LOG_ADMIN_PROXY_KEY'] -cnotmatch '^[0-9a-f]{64}$') { throw 'HTTPS proxy key must be 64 lowercase hexadecimal characters. Its value has not been printed.' }
        if ($oldMap['TRUCK_LOG_TLS_CERT_DIR'] -notmatch '^/') { throw 'HTTPS certificate directory must be an absolute path on the Linux Docker host.' }
        if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'docker-compose.https.yml') -PathType Leaf)) { throw 'The HTTPS Compose overlay is missing. HTTP will not be started.' }
        $composeVersion = (@(Invoke-UpdateNative -FilePath $DockerExe -CommandArguments @('compose', 'version', '--short') -Operation 'Compose version check') -join '').Trim()
        if ($composeVersion -notmatch '^v?(\d+\.\d+\.\d+)') { throw 'Could not verify Docker Compose version for HTTPS.' }
        if ([version]$Matches[1] -lt [version]'2.24.4') { throw 'HTTPS requires Docker Compose 2.24.4 or newer.' }
    }
    $ContextName = (@(Invoke-UpdateNative -FilePath $DockerExe -CommandArguments @('context', 'show') -Operation 'Docker context check') -join '').Trim()
    if (-not $ContextName) { throw 'Could not determine the current Docker context.' }
    Write-Host ("Docker context: $ContextName (unchanged)") -ForegroundColor Cyan
    if ($env:DOCKER_HOST) { Write-Host 'An existing DOCKER_HOST override is set; it will also remain unchanged.' }
    Write-Host ('Updating from: ' + $source.FullName)
    Write-Host ('Application: ' + $AppRoot)
    Write-Host ('Transport: ' + $(if ($UseHttps) { 'HTTPS; both Compose files will be used.' } else { 'HTTP; existing setup will start and check the services.' }))

    if (Test-Path -LiteralPath $DestinationEnv) {
        if (-not (Test-Path -LiteralPath $DestinationEnv -PathType Leaf)) { throw 'Destination .env is not a regular file.' }
        $backupDirectory = Join-Path $AppRoot '.setup-backups'
        New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
        $BackupPath = Join-Path $backupDirectory ('.env-before-update-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.bak')
        Copy-Item -LiteralPath $DestinationEnv -Destination $BackupPath -Force -ErrorAction Stop
        Write-Host ('Existing destination .env backed up to: ' + $BackupPath)
    }
    Copy-Item -LiteralPath $source.FullName -Destination $DestinationEnv -Force
    $CopiedEnvironment = $true
    Write-Host 'Copied the old .env. The source file was left unchanged; credential values are never displayed.'

    # Compose must read the imported .env, rather than stale application settings
    # left in this PowerShell process. Docker connection/context variables stay intact.
    foreach ($entry in @(Get-ChildItem Env:)) {
        if ($entry.Name -match '^(TRUCK_LOG_|RXO_|SMTP_)|^(NODE_ENV|TZ|COMPOSE_FILE|COMPOSE_PROFILES|COMPOSE_PROJECT_NAME|COMPOSE_ENV_FILES)$') {
            $EnvironmentRestore[$entry.Name] = $entry.Value
            Remove-Item -LiteralPath ('Env:' + $entry.Name)
        }
    }
    $Release = (Get-Content -LiteralPath (Join-Path $AppRoot 'VERSION') -Raw).Trim()
    if ($Release -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'The application VERSION is invalid.' }
    if (-not $EnvironmentRestore.ContainsKey('TRUCK_LOG_RELEASE')) { $EnvironmentRestore['TRUCK_LOG_RELEASE'] = $null }
    $env:TRUCK_LOG_RELEASE = $Release

    Push-Location $AppRoot
    try {
        $setupArguments = @('-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $SetupPath)
        if ($UseHttps) { $setupArguments += '-NoStart' }
        # setup-docker.ps1 calls exit: isolate it so the updater can continue.
        Invoke-UpdateNative -FilePath $PowerShellExe -CommandArguments $setupArguments -Operation 'Truck Log setup' | Out-Host
        $updatedMap = Read-UpdateEnvironment $DestinationEnv
        foreach ($key in @('TRUCK_LOG_DATABASE_USERNAME', 'TRUCK_LOG_DATABASE_PASSWORD', 'TRUCK_LOG_DATABASE_NAME')) {
            if ($updatedMap[$key] -cne $oldMap[$key]) { throw "Setup changed $key unexpectedly. Stop and review the saved .env backup." }
        }
        if ($UseHttps) {
            $composeArguments = @('compose', '-p', 'truck-log', '--env-file', $DestinationEnv, '-f', 'docker-compose.yml', '-f', 'docker-compose.https.yml')
            Invoke-UpdateNative -FilePath $DockerExe -CommandArguments ($composeArguments + @('config', '--quiet')) -Operation 'HTTPS configuration validation' | Out-Host
            Invoke-UpdateNative -FilePath $DockerExe -CommandArguments ($composeArguments + @('up', '-d', '--build')) -Operation 'HTTPS startup' | Out-Host
            Write-Host 'Waiting up to six minutes for the database, API and web service...'
            $deadline = (Get-Date).AddMinutes(6)
            do {
                $databaseHealth = Get-UpdateHealth 'truck-log-postgres'
                $apiHealth = Get-UpdateHealth 'truck-log-server'
                $webHealth = Get-UpdateHealth 'truck-log-web'
                Write-Host "  Database=$databaseHealth  API=$apiHealth  WEB=$webHealth"
                if ($databaseHealth -eq 'healthy' -and $apiHealth -eq 'healthy' -and $webHealth -eq 'healthy') { break }
                if ((Get-Date) -ge $deadline) { throw 'HTTPS core services did not become healthy within six minutes. Review Docker logs; the imported .env and all volumes have been kept.' }
                Start-Sleep -Seconds 5
            } while ($true)
            Invoke-UpdateNative -FilePath $DockerExe -CommandArguments ($composeArguments + @('ps')) -Operation 'HTTPS service status' | Out-Host
        }
        $finalMap = Read-UpdateEnvironment $DestinationEnv
        Write-Host ''
        Write-Host ('Truck Log ' + $Release + ' update completed. Existing administrator accounts and database volumes were reused.') -ForegroundColor Green
        if ($finalMap.ContainsKey('TRUCK_LOG_PUBLIC_ORIGIN')) { Write-Host ('Open: ' + $finalMap['TRUCK_LOG_PUBLIC_ORIGIN']) }
        Write-Host 'The selected Docker context was not changed. No administrator bootstrap was run.'
    } finally { Pop-Location }
} catch {
    Write-Host ('UPDATE STOPPED: ' + $_.Exception.Message) -ForegroundColor Red
    if ($CopiedEnvironment) { Write-Host 'The imported .env has been kept for troubleshooting. The old source .env was not changed.' }
    if ($BackupPath) { Write-Host ('Previous destination .env backup: ' + $BackupPath) }
    exit 1
} finally {
    foreach ($key in $EnvironmentRestore.Keys) {
        if ($null -eq $EnvironmentRestore[$key]) { Remove-Item -LiteralPath ('Env:' + $key) -ErrorAction SilentlyContinue }
        else { Set-Item -LiteralPath ('Env:' + $key) -Value $EnvironmentRestore[$key] }
    }
}
