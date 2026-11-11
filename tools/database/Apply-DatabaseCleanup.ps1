[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PgContainer,
    [string]$Database = 'MeshForge',
    [string]$DatabaseUser = '',
    [string]$SqlPath = (Join-Path $PSScriptRoot 'cleanup.sql'),
    [string]$ValidationPath = (Join-Path $PSScriptRoot 'validate.sql'),
    [string]$LegacyPath = (Join-Path $PSScriptRoot 'legacy-import.sql'),
    [string]$BackupDirectory = (Join-Path $PSScriptRoot 'backups')
)
$ErrorActionPreference = 'Stop'
if ($PgContainer -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') { throw 'Use a Docker container name or ID.' }
$inputFiles = @($SqlPath, $ValidationPath)
if (Select-String -LiteralPath $SqlPath -SimpleMatch '\ir legacy-import.sql' -Quiet) { $inputFiles += $LegacyPath }
foreach ($inputFile in $inputFiles) {
    if (-not (Test-Path -LiteralPath $inputFile -PathType Leaf)) { throw "Missing file: $inputFile" }
}

function Invoke-DockerChecked([string[]]$DockerArguments) {
    $result = @(& docker @DockerArguments)
    if ($LASTEXITCODE -ne 0) { throw 'Docker operation failed. The original backup is retained.' }
    return $result
}

# Verify the delivered files when running the standalone cleanup package.
$manifestPath = Join-Path (Split-Path -Parent $SqlPath) 'SHA256SUMS.txt'
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    foreach ($inputFile in $inputFiles) {
        $name = Split-Path -Leaf $inputFile
        $entry = @(Get-Content -LiteralPath $manifestPath | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+' + [regex]::Escape($name) + '$') })
        if ($entry.Count -ne 1) { throw "Missing or ambiguous checksum: $name" }
        $expected = ($entry[0] -split '\s+', 2)[0]
        if ((Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash -ine $expected) { throw "Checksum mismatch: $name" }
    }
}

if ([string]::IsNullOrWhiteSpace($DatabaseUser)) {
    $databaseUsers = @(& docker exec $PgContainer printenv POSTGRES_USER)
    $DatabaseUser = if ($LASTEXITCODE -eq 0 -and $databaseUsers.Count -eq 1) { $databaseUsers[0] } else { 'postgres' }
}
$connection = @('exec', '--env', "PGDATABASE=$Database", '--env', "PGUSER=$DatabaseUser", $PgContainer)
$probe = @(Invoke-DockerChecked ($connection + @('psql', '-X', '-At', '--set', 'ON_ERROR_STOP=1', '--command', "SELECT (to_regclass('public.users') IS NOT NULL AND to_regclass('public.gearsets') IS NOT NULL AND to_regclass('public.parts') IS NOT NULL)::text")))
if ($probe.Count -ne 1 -or $probe[0] -ne 'true') { throw 'This target does not have the expected MeshForge shared master tables.' }

$resolvedBackup = [IO.Path]::GetFullPath($BackupDirectory)
[IO.Directory]::CreateDirectory($resolvedBackup) | Out-Null
$operationId = [Guid]::NewGuid().ToString('N')
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$containerBackup = "/tmp/meshforge-before-cleanup-$operationId.dump"
$containerDirectory = "/tmp/meshforge-cleanup-$operationId"
$containerSql = "$containerDirectory/cleanup.sql"
$containerValidation = "$containerDirectory/validate.sql"
$containerLegacy = "$containerDirectory/legacy-import.sql"
$backupFile = Join-Path $resolvedBackup "MeshForge-before-cleanup-$stamp-$operationId.dump"

# pg_dump runs in the existing PostgreSQL container. No database password is printed or copied.
Invoke-DockerChecked ($connection + @('pg_dump', '--format=custom', '--no-owner', '--file', $containerBackup)) | Out-Null
Invoke-DockerChecked ($connection + @('pg_restore', '--list', $containerBackup)) | Out-Null
Invoke-DockerChecked @('cp', "${PgContainer}:$containerBackup", $backupFile) | Out-Null
if ((Get-Item -LiteralPath $backupFile).Length -lt 512) { throw 'The backup is unexpectedly small. Cleanup was not started.' }
$backupHash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
@{
    database = $Database; container = $PgContainer; createdUtc = [DateTime]::UtcNow.ToString('o')
    file = (Split-Path -Leaf $backupFile); sha256 = $backupHash
} | ConvertTo-Json | Set-Content -LiteralPath ($backupFile + '.json') -Encoding UTF8
Write-Output "Verified pre-cleanup backup: $backupFile"

try {
    Invoke-DockerChecked @('exec', $PgContainer, 'mkdir', '-m', '700', $containerDirectory) | Out-Null
    Invoke-DockerChecked @('cp', $SqlPath, "${PgContainer}:$containerSql") | Out-Null
    Invoke-DockerChecked @('cp', $ValidationPath, "${PgContainer}:$containerValidation") | Out-Null
    if ($inputFiles -contains $LegacyPath) { Invoke-DockerChecked @('cp', $LegacyPath, "${PgContainer}:$containerLegacy") | Out-Null }
    Invoke-DockerChecked ($connection + @('psql', '-X', '--set', 'ON_ERROR_STOP=1', '--file', $containerSql))
    Invoke-DockerChecked ($connection + @('psql', '-X', '--set', 'ON_ERROR_STOP=1', '--file', $containerValidation))
    Write-Output 'Cleanup committed and structural verification passed. Review the flagged master-data conflicts separately.'
}
finally {
    # Only this invocation's explicitly named temporary files are removed.
    Invoke-DockerChecked @('exec', $PgContainer, 'rm', '-f', $containerBackup, $containerSql, $containerValidation, $containerLegacy) | Out-Null
    Invoke-DockerChecked @('exec', $PgContainer, 'rmdir', $containerDirectory) | Out-Null
}
