param(
    [string]$SqlServer = "usftwplvsql01",
    [string]$SqlDatabase = "GearAppsNew",
    [string]$OutputDirectory = ".\tools\manufacturing\data-import\work\base-sql-fresh"
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) { throw $Message }
function Pass([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-SqlRows([string]$Query) {
    $out = & sqlcmd -S $SqlServer -E -d $SqlDatabase -b -W -s "|" -Q $Query 2>&1
    if ($LASTEXITCODE -ne 0) {
        $out | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        Fail "SQL Server query failed."
    }
    return @($out)
}

function Export-QueryJson(
    [Parameter(Mandatory=$true)][string]$Query,
    [Parameter(Mandatory=$true)][string]$FileName,
    [Parameter(Mandatory=$true)][string]$TargetDirectory
) {
    $tmp = Join-Path $env:TEMP ("gearapps-base-" + [guid]::NewGuid().ToString("N") + ".txt")
    try {
        $out = & sqlcmd -S $SqlServer -E -d $SqlDatabase -b -W -s "|" `
            -Q "SET NOCOUNT ON; $Query" 2>&1
        if ($LASTEXITCODE -ne 0) {
            $out | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            Fail "Export failed for $FileName"
        }

        [System.IO.File]::WriteAllLines(
            $tmp, [string[]]$out, (New-Object System.Text.UTF8Encoding($false))
        )

        $lines = @(Get-Content -LiteralPath $tmp | Where-Object { $_.Trim() -ne "" })
        if ($lines.Count -lt 1) { Fail "No export output for $FileName" }

        $headers = @($lines[0].Split('|') | ForEach-Object { $_.Trim() })
        $start = 1
        if ($lines.Count -gt 1 -and $lines[1] -match '^-+(\|-+)*$') { $start = 2 }

        $rows = @()
        for ($i=$start; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^\(\d+ rows? affected\)$') { continue }
            $values = @($lines[$i].Split('|'))
            if ($values.Count -ne $headers.Count) {
                Fail "Column-count mismatch in $FileName at line: $($lines[$i])"
            }
            $obj = [ordered]@{}
            for ($c=0; $c -lt $headers.Count; $c++) {
                $v = $values[$c].Trim()
                $obj[$headers[$c]] = if ($v -eq 'NULL') { $null } else { $v }
            }
            $rows += [pscustomobject]$obj
        }

        [System.IO.File]::WriteAllText(
            (Join-Path $TargetDirectory $FileName),
            (ConvertTo-Json -InputObject @($rows) -Depth 10),
            (New-Object System.Text.UTF8Encoding($false))
        )
        Pass "$FileName = $($rows.Count) rows"
        return [int]$rows.Count
    }
    finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
    Fail "sqlcmd is required and was not found in PATH."
}

$OutputFull = [System.IO.Path]::GetFullPath($OutputDirectory)
$Parent = Split-Path -Parent $OutputFull
$Leaf = Split-Path -Leaf $OutputFull
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Temp = Join-Path $Parent ("_" + $Leaf + "_incoming_" + $Stamp)
$Backup = Join-Path $Parent ("_" + $Leaf + "_backup_" + $Stamp)

try {
    Step "Checking SQL Server source"
    $dbRows = Invoke-SqlRows "SET NOCOUNT ON; SELECT 'DB=' + DB_NAME();"
    $db = $dbRows | Where-Object { $_ -like 'DB=*' } | Select-Object -First 1
    if (-not $db -or ($db -replace '^DB=','').Trim() -ne $SqlDatabase) {
        Fail "Connected database did not verify as $SqlDatabase."
    }
    Pass "$SqlServer / $SqlDatabase"

    Step "Preparing safe temporary base-data export"
    if (Test-Path -LiteralPath $Temp) { Remove-Item $Temp -Recurse -Force }
    New-Item -ItemType Directory -Path $Temp -Force | Out-Null

    $counts = [ordered]@{}
    $counts.departments = Export-QueryJson `
        "SELECT Dept_ID, Department_ID, Department_Desc FROM dbo.tbl_departments" `
        "departments.json" $Temp
    $counts.employees = Export-QueryJson `
        "SELECT Emp_ID, Dept_ID, Name_First, Name_Last, Status FROM dbo.tbl_Employees" `
        "employees.json" $Temp
    $counts.machines = Export-QueryJson `
        "SELECT Machine_ID, Asset_ID, Dept_ID, Cell, Status FROM dbo.tbl_Machines" `
        "machines.json" $Temp
    $counts.models = Export-QueryJson `
        "SELECT Model_ID, Model, Type, Status, Date_Added, Emp_ID FROM dbo.tblMODEL" `
        "models.json" $Temp
    $counts.summaries = Export-QueryJson `
        "SELECT Summary_ID, Summary, Summary_Rev, Model_ID, HoS, Date_Added, Status, Emp_ID FROM dbo.tblSUMMARY" `
        "summaries.json" $Temp
    $counts.gears = Export-QueryJson `
        "SELECT Gear_ID, LTRIM(RTRIM(Gear)) AS Gear, Summary_ID, Teeth, Date_Added, Status, Emp_ID, Roll_Master_Needed FROM dbo.tblGEAR" `
        "gears.json" $Temp
    $counts.pinions = Export-QueryJson `
        "SELECT Pinion_ID, LTRIM(RTRIM(Pinion)) AS Pinion, Summary_ID, Teeth, Date_Added, Status, Emp_ID, Roll_Master_Needed FROM dbo.tblPINION" `
        "pinions.json" $Temp
    $counts.cutter_pull_reasons = Export-QueryJson `
        "SELECT PCR_ID, LTRIM(RTRIM(PCR_Desc)) AS PCR_Desc FROM dbo.tbl_CT_Pull_Cutter_Reason" `
        "cutter_pull_reasons.json" $Temp

    foreach ($required in @('departments','employees','machines','models','summaries','gears','pinions','cutter_pull_reasons')) {
        if ([int]$counts[$required] -le 0) {
            Fail "Fresh SQL Server base export has zero rows for $required."
        }
    }

    $manifest = [ordered]@{
        generated_at = (Get-Date).ToString('o')
        sql_server = $SqlServer
        sql_database = $SqlDatabase
        export_mode = 'fresh-safe-swap'
        row_counts = $counts
        source = 'SQL Server'
    }
    $manifest | ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath (Join-Path $Temp 'base-manifest.json') -Encoding utf8

    Step "Promoting fresh base-data export"
    $movedOld = $false
    if (Test-Path -LiteralPath $OutputFull) {
        Move-Item -LiteralPath $OutputFull -Destination $Backup
        $movedOld = $true
    }
    try {
        Move-Item -LiteralPath $Temp -Destination $OutputFull
    }
    catch {
        if (-not (Test-Path $OutputFull) -and $movedOld -and (Test-Path $Backup)) {
            Move-Item -LiteralPath $Backup -Destination $OutputFull
        }
        throw
    }

    Pass "Fresh base-data export promoted to $OutputFull"
    Write-Host ""
    Write-Host "No SQL Server data was modified." -ForegroundColor Cyan
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
