param(
    [string]$SqlServer = "usftwplvsql01",
    [string]$SqlDatabase = "GearAppsNew",
    [string]$PgContainer = "dana-postgres",
    [string]$PgHost = "usftwvmdocker",
    [int]$PgPort = 5432,
    [string]$PgUser = "api",
    [string]$PgPassword = "api",
    [string]$PgDatabase = "GearApps",
    [string]$ExportDirectory = ".\tools/manufacturing/base-data/data",
    [string]$Importer = ".\tools\manufacturing\base-data\import-base-data.mjs"
)

$ErrorActionPreference = "Stop"
$BuildTag = "CURRENT_BASE_DATA_RESTORE"

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Pass([string]$Message) {
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    exit 1
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$ExportPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $ExportDirectory))
$ImporterPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $Importer))

function Export-SqlServerJson {
    param(
        [Parameter(Mandatory=$true)][string]$Query,
        [Parameter(Mandatory=$true)][string]$FileName
    )

    $tmp = Join-Path $env:TEMP ("gearapps_" + [Guid]::NewGuid().ToString("N") + ".txt")

    try {
        $output = @(
            & sqlcmd `
                -S $SqlServer `
                -E `
                -d $SqlDatabase `
                -b `
                -W `
                -s "|" `
                -Q "SET NOCOUNT ON; $Query" `
                2>&1
        )

        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            Write-Host ""
            Write-Host "SQLCMD ERROR OUTPUT:" -ForegroundColor Red
            $output | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            Fail "SQL Server export failed: $FileName"
        }

        [System.IO.File]::WriteAllLines(
            $tmp,
            [string[]]$output,
            (New-Object System.Text.UTF8Encoding($false))
        )

        $lines = @(
            Get-Content -LiteralPath $tmp |
            Where-Object { $_.Trim() -ne "" }
        )

        if ($lines.Count -lt 2) {
            Fail "SQL Server export returned no usable rows for $FileName"
        }

        $headers = @(
            $lines[0].Split('|') |
            ForEach-Object { $_.Trim() }
        )

        $dataStart = 1
        if ($lines.Count -gt 1 -and $lines[1].Trim() -match '^-+(\|-+)*$') {
            $dataStart = 2
        }

        $rows = @()

        for ($i = $dataStart; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]

            if ($line -match '^\(\d+ rows? affected\)$') {
                continue
            }

            $values = @($line.Split('|'))

            if ($values.Count -ne $headers.Count) {
                Write-Host ""
                Write-Host "Bad export row in ${FileName}:" -ForegroundColor Red
                Write-Host $line -ForegroundColor Red
                Fail "Column-count mismatch in $FileName. Expected $($headers.Count), got $($values.Count)."
            }

            $obj = [ordered]@{}

            for ($c = 0; $c -lt $headers.Count; $c++) {
                $value = $values[$c].Trim()
                $obj[$headers[$c]] = if ($value -eq "NULL") { $null } else { $value }
            }

            $rows += [pscustomobject]$obj
        }

        $json = ConvertTo-Json -InputObject @($rows) -Depth 10

        [System.IO.File]::WriteAllText(
            (Join-Path $ExportPath $FileName),
            $json,
            (New-Object System.Text.UTF8Encoding($false))
        )

        try {
            $null = Get-Content -LiteralPath (Join-Path $ExportPath $FileName) -Raw | ConvertFrom-Json
        }
        catch {
            Fail "Generated JSON failed validation for $FileName : $($_.Exception.Message)"
        }

        Write-Host ("  [PASS] {0,-28} {1,5} rows" -f $FileName, $rows.Count) -ForegroundColor Green
    }
    finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "===================================================="
Write-Host " GearApps Legacy Base-Data Restore"
Write-Host " BUILD: $BuildTag"
Write-Host "===================================================="

Step "Checking required commands"
foreach ($cmd in @("sqlcmd", "docker", "node")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Fail "$cmd was not found in PATH."
    }
}
if (-not (Test-Path -LiteralPath $ImporterPath)) {
    Fail "Importer not found: $ImporterPath"
}
Pass "sqlcmd, docker, node, and importer found"

Step "Checking importer version"
$ImporterText = Get-Content -LiteralPath $ImporterPath -Raw

if ($ImporterText -match '"part-summaries"') {
    Fail "Importer still references the old hyphenated table part-summaries. Replace import-base-data.mjs with the updated copy first."
}
if ($ImporterText -notmatch 'cutter_pull_reasons\.json') {
    Fail "Importer does not include cutter_pull_reasons.json. Replace import-base-data.mjs with the updated copy first."
}
if ($ImporterText -notmatch 'INSERT INTO roll_masters') {
    Fail "Importer does not contain roll master carryover logic."
}
if ($ImporterText -notmatch "await importParts\(gears, 'RING'\)") {
    Fail "Importer does not contain Gear -> RING part import logic."
}
if ($ImporterText -notmatch "await importParts\(pinions, 'PINION'\)") {
    Fail "Importer does not contain Pinion -> PINION part import logic."
}
Pass "Importer structure is correct"

Step "Checking SQL Server source"
& sqlcmd -S $SqlServer -E -d $SqlDatabase -b -Q "SET NOCOUNT ON; SELECT DB_NAME() AS database_name;" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "Cannot connect to SQL Server $SqlServer / $SqlDatabase"
}
Pass "SQL Server $SqlServer / $SqlDatabase"

Step "Checking required legacy SQL Server tables"

$RequiredLegacyTables = @(
    "tbl_departments",
    "tbl_Employees",
    "tbl_Machines",
    "tblMODEL",
    "tblSUMMARY",
    "tblGEAR",
    "tblPINION",
    "tbl_CT_Pull_Cutter_Reason"
)

$MissingLegacyTables = @()

foreach ($TableName in $RequiredLegacyTables) {
    $CheckQuery = @"
SET NOCOUNT ON;
SELECT COUNT(*)
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = '$TableName';
"@

    $Result = (& sqlcmd -S $SqlServer -E -d $SqlDatabase -b -h -1 -W -Q $CheckQuery).Trim()

    if ($LASTEXITCODE -ne 0) {
        Fail "Failed while checking legacy table dbo.$TableName"
    }

    if ($Result -eq "1") {
        Write-Host ("  [PASS] dbo.{0}" -f $TableName) -ForegroundColor Green
    }
    else {
        Write-Host ("  [MISSING] dbo.{0}" -f $TableName) -ForegroundColor Red
        $MissingLegacyTables += $TableName
    }
}

if ($MissingLegacyTables.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing legacy SQL Server table(s):" -ForegroundColor Red
    foreach ($MissingTable in $MissingLegacyTables) {
        Write-Host ("  dbo.{0}" -f $MissingTable) -ForegroundColor Red
    }
    Fail "Legacy source-table preflight failed."
}

Pass "All required legacy SQL Server tables exist"

Step "Checking required legacy SQL Server columns"

$RequiredLegacyColumns = [ordered]@{
    "tbl_departments" = @("Dept_ID","Department_ID","Department_Desc")
    "tbl_Employees" = @("Emp_ID","Dept_ID","Name_First","Name_Last","Status")
    "tbl_Machines" = @("Machine_ID","Asset_ID","Dept_ID","Cell","Status")
    "tblMODEL" = @("Model_ID","Model","Type","Status","Date_Added","Emp_ID")
    "tblSUMMARY" = @("Summary_ID","Summary","Summary_Rev","Model_ID","HoS","Date_Added","Status","Emp_ID")
    "tblGEAR" = @("Gear_ID","Gear","Summary_ID","Teeth","Date_Added","Status","Emp_ID","Roll_Master_Needed")
    "tblPINION" = @("Pinion_ID","Pinion","Summary_ID","Teeth","Date_Added","Status","Emp_ID","Roll_Master_Needed")
    "tbl_CT_Pull_Cutter_Reason" = @("PCR_ID","PCR_Desc")
}

$MissingLegacyColumns = @()

foreach ($TableName in $RequiredLegacyColumns.Keys) {
    foreach ($ColumnName in $RequiredLegacyColumns[$TableName]) {
        $CheckQuery = @"
SET NOCOUNT ON;
SELECT COUNT(*)
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = '$TableName'
  AND COLUMN_NAME = '$ColumnName';
"@

        $Result = (& sqlcmd -S $SqlServer -E -d $SqlDatabase -b -h -1 -W -Q $CheckQuery 2>&1).Trim()

        if ($LASTEXITCODE -ne 0) {
            Write-Host $Result -ForegroundColor Red
            Fail "Failed while checking dbo.$TableName.$ColumnName"
        }

        if ($Result -ne "1") {
            $MissingLegacyColumns += "dbo.$TableName.$ColumnName"
        }
    }
}

if ($MissingLegacyColumns.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing legacy SQL Server column(s):" -ForegroundColor Red
    $MissingLegacyColumns | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Fail "Legacy source-column preflight failed."
}

Pass "All required legacy SQL Server columns exist"

Step "Checking PostgreSQL target with Docker psql"
& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -v ON_ERROR_STOP=1 -c "SELECT current_database();" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "Cannot connect to PostgreSQL Compose service $PgContainer / $PgDatabase"
}
Pass "PostgreSQL Compose service $PgContainer / $PgDatabase"

Step "Checking PostgreSQL target schema"
$SchemaCheck = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('departments','users','machines','models','part_summaries','part_types','parts','roll_masters','cutter_pull_reasons');").Trim()
if ([int]$SchemaCheck -ne 9) {
    Fail "Target schema is incomplete. Expected 9 required base/master tables; found $SchemaCheck."
}
$PartTypeCheck = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM part_types WHERE code IN ('RING','PINION') AND enabled=true;").Trim()
if ([int]$PartTypeCheck -ne 2) {
    Fail "RING and PINION part_types must exist and be enabled before import."
}
Pass "Required PostgreSQL tables and part types are ready"

Step "Preparing fresh export directory"
if (Test-Path -LiteralPath $ExportPath) {
    Remove-Item -LiteralPath $ExportPath -Recurse -Force
}
New-Item -ItemType Directory -Path $ExportPath -Force | Out-Null
Pass $ExportPath

Step "Exporting fresh data from GearAppsNew"
Export-SqlServerJson "SELECT Dept_ID, Department_ID, Department_Desc FROM dbo.tbl_departments" "departments.json"
Export-SqlServerJson "SELECT Emp_ID, Dept_ID, Name_First, Name_Last, Status FROM dbo.tbl_Employees" "employees.json"
Export-SqlServerJson "SELECT Machine_ID, Asset_ID, Dept_ID, Cell, Status FROM dbo.tbl_Machines" "machines.json"
Export-SqlServerJson "SELECT Model_ID, Model, Type, Status, Date_Added, Emp_ID FROM dbo.tblMODEL" "models.json"
Export-SqlServerJson "SELECT Summary_ID, Summary, Summary_Rev, Model_ID, HoS, Date_Added, Status, Emp_ID FROM dbo.tblSUMMARY" "summaries.json"
Export-SqlServerJson "SELECT Gear_ID, LTRIM(RTRIM(Gear)) AS Gear, Summary_ID, Teeth, Date_Added, Status, Emp_ID, Roll_Master_Needed FROM dbo.tblGEAR" "gears.json"
Export-SqlServerJson "SELECT Pinion_ID, LTRIM(RTRIM(Pinion)) AS Pinion, Summary_ID, Teeth, Date_Added, Status, Emp_ID, Roll_Master_Needed FROM dbo.tblPINION" "pinions.json"
Export-SqlServerJson "SELECT PCR_ID, LTRIM(RTRIM(PCR_Desc)) AS PCR_Desc FROM dbo.tbl_CT_Pull_Cutter_Reason" "cutter_pull_reasons.json"
Pass "Fresh SQL Server export complete"

Step "Validating source counts"
$counts = @{}
foreach ($name in @(
    "departments",
    "employees",
    "machines",
    "models",
    "summaries",
    "gears",
    "pinions",
    "cutter_pull_reasons"
)) {
    $path = Join-Path $ExportPath ($name + ".json")
    if (-not (Test-Path -LiteralPath $path)) {
        Fail "Missing export file: $path"
    }

    try {
        $parsedRows = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    }
    catch {
        Fail "Cannot parse $name.json : $($_.Exception.Message)"
    }

    # ConvertFrom-Json can return an entire JSON array as one pipeline object.
    # Count the elements inside the parsed JSON array explicitly.
    if ($null -eq $parsedRows) {
        $rowCount = 0
    }
    elseif ($parsedRows -is [System.Array]) {
        $rowCount = $parsedRows.Count
    }
    else {
        $rowCount = 1
    }

    $counts[$name] = [int]$rowCount

    if ($rowCount -eq 0) {
        Fail "$name.json contains zero rows."
    }
}

Write-Host ("  Departments         : {0}" -f $counts.departments)
Write-Host ("  Employees -> Users  : {0}" -f $counts.employees)
Write-Host ("  Machines            : {0}" -f $counts.machines)
Write-Host ("  Models              : {0}" -f $counts.models)
Write-Host ("  Summaries           : {0}" -f $counts.summaries)
Write-Host ("  Gears / RING        : {0}" -f $counts.gears)
Write-Host ("  Pinions / PINION    : {0}" -f $counts.pinions)
Write-Host ("  Pull Reasons        : {0}" -f $counts.cutter_pull_reasons)
Pass "Source JSON validated"

Step "Configuring PostgreSQL connection for import-base-data.mjs"
# These are the exact working PostgreSQL settings used by this GearApps project.
$env:DATABASE_HOST = $PgHost
$env:DATABASE_PORT = "$PgPort"
$env:DATABASE_USERNAME = $PgUser
$env:DATABASE_PASSWORD = $PgPassword
$env:DATABASE_NAME = $PgDatabase

Write-Host "  Host     : $PgHost"
Write-Host "  Port     : $PgPort"
Write-Host "  User     : $PgUser"
Write-Host "  Database : $PgDatabase"
Pass "Importer environment configured"

Step "Running transactional Node importer"
Push-Location $ProjectRoot
try {
    & node $ImporterPath $ExportPath
    if ($LASTEXITCODE -ne 0) {
        Fail "import-base-data.mjs failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
Pass "Node importer completed"

Step "Verifying PostgreSQL row counts and relationships"

$ExpectedParts = [int]$counts.gears + [int]$counts.pinions
$ExpectedReasons = [int]$counts.cutter_pull_reasons

Write-Host ("Expected gears        : {0}" -f $counts.gears)
Write-Host ("Expected pinions      : {0}" -f $counts.pinions)
Write-Host ("Expected parts        : {0}" -f $ExpectedParts)
Write-Host ("Expected pull reasons : {0}" -f $ExpectedReasons)

$VerifySql = @"
SELECT 'departments' AS check_name, COUNT(*)::text AS result FROM departments
UNION ALL SELECT 'users', COUNT(*)::text FROM users
UNION ALL SELECT 'machines', COUNT(*)::text FROM machines
UNION ALL SELECT 'models', COUNT(*)::text FROM models
UNION ALL SELECT 'part_summaries', COUNT(*)::text FROM part_summaries
UNION ALL SELECT 'parts', COUNT(*)::text FROM parts
UNION ALL SELECT 'roll_masters', COUNT(*)::text FROM roll_masters
UNION ALL SELECT 'PCR pull reasons', COUNT(*)::text FROM cutter_pull_reasons WHERE code LIKE 'PCR_%'
UNION ALL SELECT 'parts missing summary', COUNT(*)::text
  FROM parts p LEFT JOIN part_summaries s ON s.id=p.summary_id WHERE s.id IS NULL
UNION ALL SELECT 'parts missing part type', COUNT(*)::text
  FROM parts p LEFT JOIN part_types pt ON pt.id=p.part_type_id WHERE pt.id IS NULL
UNION ALL SELECT 'parts missing roll master', COUNT(*)::text
  FROM parts p LEFT JOIN roll_masters r ON r.part_id=p.id WHERE r.part_id IS NULL
UNION ALL SELECT 'orphan roll masters', COUNT(*)::text
  FROM roll_masters r LEFT JOIN parts p ON p.id=r.part_id WHERE p.id IS NULL
ORDER BY check_name;
"@

& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -v ON_ERROR_STOP=1 -c $VerifySql
if ($LASTEXITCODE -ne 0) {
    Fail "PostgreSQL verification query failed."
}

$PartsCount = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -c "SELECT COUNT(*) FROM parts;").Trim()
$RollCount = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -c "SELECT COUNT(*) FROM roll_masters;").Trim()
$ReasonCount = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -c "SELECT COUNT(*) FROM cutter_pull_reasons WHERE code LIKE 'PCR_%';").Trim()
$Missing = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -c "SELECT (SELECT COUNT(*) FROM parts p LEFT JOIN part_summaries s ON s.id=p.summary_id WHERE s.id IS NULL) + (SELECT COUNT(*) FROM parts p LEFT JOIN part_types pt ON pt.id=p.part_type_id WHERE pt.id IS NULL) + (SELECT COUNT(*) FROM parts p LEFT JOIN roll_masters r ON r.part_id=p.id WHERE r.part_id IS NULL) + (SELECT COUNT(*) FROM roll_masters r LEFT JOIN parts p ON p.id=r.part_id WHERE p.id IS NULL);").Trim()

if ([int]$PartsCount -ne $ExpectedParts) {
    Fail "Part count mismatch. Expected $ExpectedParts from Gear + Pinion export; PostgreSQL has $PartsCount."
}
if ([int]$RollCount -ne $ExpectedParts) {
    Fail "Roll master count mismatch. Expected $ExpectedParts; PostgreSQL has $RollCount."
}
if ([int]$ReasonCount -ne $ExpectedReasons) {
    Fail "Pull reason count mismatch. Expected $ExpectedReasons; PostgreSQL has $ReasonCount."
}
if ([int]$Missing -ne 0) {
    Fail "Relationship verification found $Missing problem(s)."
}

$Changeover = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -F "|" -c "SELECT requires_teardown,returns_to_shelf FROM cutter_pull_reasons WHERE code='PCR_002';").Trim()
if ($Changeover -ne "f|t") {
    Fail "PCR_002 CHANGEOVER flags are wrong. Expected requires_teardown=false and returns_to_shelf=true; got '$Changeover'."
}

$HyphenTables = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%-%';").Trim()
if ([int]$HyphenTables -ne 0) {
    & docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%-%' ORDER BY tablename;"
    Fail "Found $HyphenTables PostgreSQL table name(s) containing hyphens."
}

$RingCount = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -c "SELECT COUNT(*) FROM parts p JOIN part_types pt ON pt.id=p.part_type_id WHERE pt.code='RING';").Trim()
$PinionCount = (& docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer psql -U $PgUser -d $PgDatabase -At -c "SELECT COUNT(*) FROM parts p JOIN part_types pt ON pt.id=p.part_type_id WHERE pt.code='PINION';").Trim()
if ([int]$RingCount -ne [int]$counts.gears) {
    Fail "RING count mismatch. SQL Server exported $($counts.gears); PostgreSQL has $RingCount."
}
if ([int]$PinionCount -ne [int]$counts.pinions) {
    Fail "PINION count mismatch. SQL Server exported $($counts.pinions); PostgreSQL has $PinionCount."
}

Pass "Counts, relationships, part types, and underscore table naming all verified"

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host " MIGRATION PASSED" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host "Build       : $BuildTag"
Write-Host "SQL Server  : $SqlServer / $SqlDatabase"
Write-Host "PostgreSQL  : $PgHost`:$PgPort / $PgDatabase"
Write-Host "Parts       : $PartsCount"
Write-Host "Roll Masters: $RollCount"
Write-Host "Pull Reasons: $ReasonCount"
Write-Host ""
