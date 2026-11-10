param(
    [string]$SqlServer = "usftwplvsql01",
    [string]$SqlDatabase = "GearAppsNew",
    [string]$OutputDirectory = ".\tools/manufacturing/cutter-history/data"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw $Message
}

function Pass([string]$Message) {
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function SqlRows([string]$Query) {
    $out = & sqlcmd -S $SqlServer -E -d $SqlDatabase -b -W -s "|" -Q $Query 2>&1
    if ($LASTEXITCODE -ne 0) {
        $out | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        Fail "SQL Server query failed."
    }
    return @($out)
}

function Get-ExistingTable([string[]]$Candidates, [string[]]$RequiredColumns) {
    foreach ($candidate in $Candidates) {
        $candidateEscaped = $candidate.Replace("'", "''")
        $columnPredicates = @()
        foreach ($col in $RequiredColumns) {
            $columnPredicates += "MAX(CASE WHEN COLUMN_NAME='$($col.Replace("'","''"))' THEN 1 ELSE 0 END)=1"
        }
        $having = $columnPredicates -join " AND "

        $query = @"
SET NOCOUNT ON;
SELECT 'GEARAPPS_TABLE=' + TABLE_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA='dbo'
  AND TABLE_NAME='$candidateEscaped'
GROUP BY TABLE_NAME
HAVING $having;
"@

        $result = SqlRows $query |
            Where-Object { $_ -like "GEARAPPS_TABLE=*" } |
            Select-Object -First 1

        if ($result) {
            return ($result -replace '^GEARAPPS_TABLE=', '').Trim()
        }
    }
    return $null
}

function Discover-TableByColumns([string[]]$RequiredColumns, [string]$NamePattern = "%") {
    $checks = $RequiredColumns | ForEach-Object {
        "MAX(CASE WHEN COLUMN_NAME='$($_.Replace("'","''"))' THEN 1 ELSE 0 END)=1"
    }
    $having = $checks -join " AND "

    $query = @"
SET NOCOUNT ON;
SELECT TOP (1) 'GEARAPPS_TABLE=' + TABLE_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA='dbo'
  AND TABLE_NAME LIKE '$($NamePattern.Replace("'","''"))'
GROUP BY TABLE_NAME
HAVING $having
ORDER BY TABLE_NAME;
"@

    $result = SqlRows $query |
        Where-Object { $_ -like "GEARAPPS_TABLE=*" } |
        Select-Object -First 1

    if ($result) {
        return ($result -replace '^GEARAPPS_TABLE=', '').Trim()
    }

    return $null
}

function Export-Table([string]$TableName, [string]$FileName, [string]$TargetDirectory) {
    if (-not $TableName) {
        Write-Host "[SKIP] $FileName - source table not discovered" -ForegroundColor Yellow
        return 0
    }

    $escaped = $TableName.Replace("]", "]]")
    $tmp = Join-Path $env:TEMP ("gearapps-cutter-" + [guid]::NewGuid().ToString("N") + ".txt")

    try {
        $out = & sqlcmd -S $SqlServer -E -d $SqlDatabase -b -W -s "|" `
            -Q "SET NOCOUNT ON; SELECT * FROM dbo.[$escaped];" 2>&1

        if ($LASTEXITCODE -ne 0) {
            $out | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            Fail "Export failed for dbo.$TableName"
        }

        [System.IO.File]::WriteAllLines(
            $tmp,
            [string[]]$out,
            (New-Object System.Text.UTF8Encoding($false))
        )

        $lines = @(Get-Content -LiteralPath $tmp | Where-Object { $_.Trim() -ne "" })
        if ($lines.Count -lt 2) {
            [System.IO.File]::WriteAllText(
                (Join-Path $TargetDirectory $FileName),
                "[]",
                (New-Object System.Text.UTF8Encoding($false))
            )
            Pass "$FileName = 0 rows"
            return 0
        }

        $headers = @($lines[0].Split('|') | ForEach-Object { $_.Trim() })
        $start = 1
        if ($lines.Count -gt 1 -and $lines[1] -match '^-+(\|-+)*$') { $start = 2 }

        $rows = @()
        for ($i=$start; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^\(\d+ rows? affected\)$') { continue }

            $values = @($lines[$i].Split('|'))
            if ($values.Count -ne $headers.Count) {
                Fail "Column count mismatch exporting $TableName at line: $($lines[$i])"
            }

            $obj = [ordered]@{}
            for ($c=0; $c -lt $headers.Count; $c++) {
                $v = $values[$c].Trim()
                $obj[$headers[$c]] = if ($v -eq "NULL") { $null } else { $v }
            }
            $rows += [pscustomobject]$obj
        }

        $json = ConvertTo-Json -InputObject @($rows) -Depth 20
        [System.IO.File]::WriteAllText(
            (Join-Path $TargetDirectory $FileName),
            $json,
            (New-Object System.Text.UTF8Encoding($false))
        )

        Pass "$FileName = $($rows.Count) rows from dbo.$TableName"
        return $rows.Count
    }
    finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Validate-JsonFile([string]$Path, [switch]$RequireArray) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Fail "Missing expected export file: $Path"
    }

    try {
        $raw = Get-Content -LiteralPath $Path -Raw
        $parsed = $raw | ConvertFrom-Json
    }
    catch {
        Fail "Invalid JSON: $Path : $($_.Exception.Message)"
    }

    if ($RequireArray -and $null -eq $parsed) {
        Fail "Expected a JSON array in $Path"
    }

    Pass ([System.IO.Path]::GetFileName($Path))
    return $parsed
}

try {
    $OutputFull = [System.IO.Path]::GetFullPath($OutputDirectory)
    $ParentDirectory = Split-Path -Parent $OutputFull
    $OutputLeaf = Split-Path -Leaf $OutputFull
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

    $TempDirectory = Join-Path $ParentDirectory ("_" + $OutputLeaf + "_incoming_" + $Stamp)
    $BackupDirectory = Join-Path $ParentDirectory ("_" + $OutputLeaf + "_backup_" + $Stamp)

    Step "Checking SQL Server"
    $dbResult = SqlRows "SET NOCOUNT ON; SELECT 'DB=' + DB_NAME();"
    $dbLine = $dbResult | Where-Object { $_ -like "DB=*" } | Select-Object -First 1
    if (-not $dbLine -or ($dbLine -replace '^DB=', '').Trim() -ne $SqlDatabase) {
        Fail "Connected database did not verify as $SqlDatabase."
    }
    Pass "$SqlServer / $SqlDatabase"

    Step "Preparing safe temporary export"
    if (Test-Path -LiteralPath $TempDirectory) {
        Remove-Item -LiteralPath $TempDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TempDirectory -Force | Out-Null
    Pass "Temporary folder: $TempDirectory"

    Step "Discovering cutter-history source tables"

    $buildTable = Get-ExistingTable @("tbl_CT_Cutter_Build") @("Check_ID","Cutter_Body_ID")
    if (-not $buildTable) { $buildTable = Discover-TableByColumns @("Check_ID","Cutter_Body_ID") "%Cutter%" }

    $logTable = Get-ExistingTable @("tbl_CT_Log") @("Build_ID","Check_ID","Part_Count")
    if (-not $logTable) { $logTable = Discover-TableByColumns @("Build_ID","Check_ID","Part_Count") "tbl_CT%" }

    $setupTable = Get-ExistingTable @("tbl_CT_Setup") @("Check_ID")
    if (-not $setupTable) { $setupTable = Discover-TableByColumns @("Check_ID") "%Setup%" }

    $retiredTable = Get-ExistingTable @("tbl_CT_Retired_Cutters") @("Check_ID","PCR_ID")
    if (-not $retiredTable) { $retiredTable = Discover-TableByColumns @("Check_ID","PCR_ID") "%Retired%" }

    $reasonTable = Get-ExistingTable @("tbl_CT_Pull_Cutter_Reason") @("PCR_ID","PCR_Desc")
    if (-not $reasonTable) { $reasonTable = Discover-TableByColumns @("PCR_ID","PCR_Desc") "%Reason%" }

    $frequencyTable = Discover-TableByColumns @("Check_ID","Pass_Fail") "%Freq%"
    if (-not $frequencyTable) {
        $frequencyTable = Discover-TableByColumns @("Check_ID","Total_Fr") "tbl_CT%"
    }

    if ($frequencyTable -eq "TABLE_NAME") {
        Fail "Frequency discovery returned a SQL header instead of a table name."
    }

    $machineTable = Get-ExistingTable @("tbl_Machines") @("Machine_ID")

    if (-not $buildTable) { Fail "Could not discover cutter build table." }
    if (-not $logTable) { Fail "Could not discover central cutter log table." }
    if (-not $setupTable) { Fail "Could not discover cutter setup table." }
    if (-not $frequencyTable) { Fail "Could not discover cutter frequency table." }
    if (-not $retiredTable) { Fail "Could not discover retired cutter table." }
    if (-not $reasonTable) { Fail "Could not discover pull-reason table." }
    if (-not $machineTable) { Fail "Could not discover machine table." }

    $manifest = [ordered]@{
        generated_at = (Get-Date).ToString("o")
        sql_server = $SqlServer
        sql_database = $SqlDatabase
        export_mode = "fresh-safe-swap"
        source_tables = [ordered]@{
            cutter_build = $buildTable
            central_log = $logTable
            setup = $setupTable
            frequency = $frequencyTable
            retired = $retiredTable
            pull_reason = $reasonTable
            machines = $machineTable
        }
        migration_policy = [ordered]@{
            preserve_retired_history = $true
            retired_in_current_inventory = $false
            preserve_setup_history = $true
            preserve_frequency_history = $true
            preserve_piece_counts = $true
            preserve_legacy_build_id_as_reference = $true
            postgres_uuid_is_primary_key = $true
        }
    }

    $manifest.source_tables.GetEnumerator() | ForEach-Object {
        Write-Host ("  {0,-18} {1}" -f $_.Key, $_.Value)
    }

    Step "Exporting fresh legacy cutter history"

    $counts = [ordered]@{}
    $counts.cutter_builds = Export-Table $buildTable "cutter_builds_legacy.json" $TempDirectory
    $counts.logs = Export-Table $logTable "cutter_log_legacy.json" $TempDirectory
    $counts.setups = Export-Table $setupTable "cutter_setups_legacy.json" $TempDirectory
    $counts.frequency = Export-Table $frequencyTable "cutter_frequency_legacy.json" $TempDirectory
    $counts.retired = Export-Table $retiredTable "cutter_retired_legacy.json" $TempDirectory
    $counts.pull_reasons = Export-Table $reasonTable "cutter_pull_reasons_legacy.json" $TempDirectory
    $counts.machines = Export-Table $machineTable "machines_legacy.json" $TempDirectory

    $manifest.row_counts = $counts
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $TempDirectory "manifest.json") -Encoding utf8

    Step "Validating fresh export"

    $requiredFiles = @(
        "manifest.json",
        "cutter_builds_legacy.json",
        "cutter_log_legacy.json",
        "cutter_setups_legacy.json",
        "cutter_frequency_legacy.json",
        "cutter_retired_legacy.json",
        "cutter_pull_reasons_legacy.json",
        "machines_legacy.json"
    )

    foreach ($name in $requiredFiles) {
        $requireArray = $name -ne "manifest.json"
        Validate-JsonFile (Join-Path $TempDirectory $name) -RequireArray:$requireArray | Out-Null
    }

    # Core datasets must not unexpectedly be empty.
    if ([int]$counts.cutter_builds -le 0) { Fail "Fresh export has zero cutter builds." }
    if ([int]$counts.logs -le 0) { Fail "Fresh export has zero cutter log rows." }
    if ([int]$counts.setups -le 0) { Fail "Fresh export has zero setup rows." }
    if ([int]$counts.frequency -le 0) { Fail "Fresh export has zero frequency rows." }
    if ([int]$counts.retired -le 0) { Fail "Fresh export has zero retired rows." }

    # Sanity relationships. These are warnings, not destructive fixes.
    $builds = Get-Content -LiteralPath (Join-Path $TempDirectory "cutter_builds_legacy.json") -Raw | ConvertFrom-Json
    $logs = Get-Content -LiteralPath (Join-Path $TempDirectory "cutter_log_legacy.json") -Raw | ConvertFrom-Json
    $setups = Get-Content -LiteralPath (Join-Path $TempDirectory "cutter_setups_legacy.json") -Raw | ConvertFrom-Json
    $frequency = Get-Content -LiteralPath (Join-Path $TempDirectory "cutter_frequency_legacy.json") -Raw | ConvertFrom-Json
    $retired = Get-Content -LiteralPath (Join-Path $TempDirectory "cutter_retired_legacy.json") -Raw | ConvertFrom-Json

    $tocCounts = [ordered]@{
        CB = @($logs | Where-Object { $_.ToC_ID -eq "CB" }).Count
        CS = @($logs | Where-Object { $_.ToC_ID -eq "CS" }).Count
        FC = @($logs | Where-Object { $_.ToC_ID -eq "FC" }).Count
        CP = @($logs | Where-Object { $_.ToC_ID -eq "CP" }).Count
    }

    $validationReport = [ordered]@{
        generated_at = (Get-Date).ToString("o")
        source_row_counts = $counts
        log_toc_counts = $tocCounts
        notes = @(
            "This is a source snapshot only.",
            "Known legacy orphan/reused Check_ID cleanup is intentionally handled after export.",
            "No SQL Server data was changed."
        )
    }

    $validationReport | ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath (Join-Path $TempDirectory "fresh-export-validation.json") -Encoding utf8

    Pass "Fresh export validation complete"

    Step "Promoting fresh export"

    $movedOld = $false
    try {
        if (Test-Path -LiteralPath $OutputFull) {
            Move-Item -LiteralPath $OutputFull -Destination $BackupDirectory
            $movedOld = $true
            Pass "Previous export backed up to: $BackupDirectory"
        }

        Move-Item -LiteralPath $TempDirectory -Destination $OutputFull
        Pass "Fresh export promoted to: $OutputFull"
    }
    catch {
        Write-Host "[ERROR] Export promotion failed: $($_.Exception.Message)" -ForegroundColor Red

        if (-not (Test-Path -LiteralPath $OutputFull) -and $movedOld -and (Test-Path -LiteralPath $BackupDirectory)) {
            Move-Item -LiteralPath $BackupDirectory -Destination $OutputFull
            Write-Host "[RECOVERED] Previous export restored." -ForegroundColor Yellow
        }

        throw
    }

    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Green
    Write-Host " FRESH CUTTER HISTORY EXPORT COMPLETE" -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Green
    Write-Host "Source:  $SqlServer / $SqlDatabase"
    Write-Host "Current: $OutputFull"
    if ($movedOld) {
        Write-Host "Backup:  $BackupDirectory"
    }
    Write-Host ""
    Write-Host "Fresh counts:" -ForegroundColor Cyan
    $counts.GetEnumerator() | ForEach-Object {
        Write-Host ("  {0,-16} {1}" -f $_.Key, $_.Value)
    }
    Write-Host ""
    Write-Host "No SQL Server data was modified." -ForegroundColor Cyan
}
catch {
    Write-Host ""
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "The previous tools/manufacturing/cutter-history/data was not replaced unless the fresh export fully validated." -ForegroundColor Yellow
    exit 1
}
