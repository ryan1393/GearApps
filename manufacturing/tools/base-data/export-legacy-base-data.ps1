param(
  [Parameter(Mandatory=$true)]
  [string]$SqlServer,

  [string]$Database = "GearApps",

  [string]$OutputDirectory = ".\tools/base-data/data"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name SqlServer)) {
  throw "PowerShell SqlServer module is required. Install-Module SqlServer"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$queries = @{
  "departments.json" = @"
SELECT Dept_ID, Department_ID, Department_Desc
FROM dbo.tbl_Departments
ORDER BY Dept_ID;
"@

  "employees.json" = @"
SELECT Emp_ID, Dept_ID, Name_First, Name_Last, Status
FROM dbo.tbl_Employees
ORDER BY Emp_ID;
"@


  "machines.json" = @"
EXEC dbo.sp__dgv_Machine;
"@

  "models.json" = @"
SELECT Model_ID, Model, Type, Status, Date_Added, Emp_ID
FROM dbo.tblMODEL
ORDER BY Model_ID;
"@

  "summaries.json" = @"
SELECT Summary_ID, Summary, Summary_Rev, Model_ID, HoS, Date_Added, Status, Emp_ID
FROM dbo.tblSUMMARY
ORDER BY Summary_ID;
"@

  "gears.json" = @"
SELECT Gear_ID, LTRIM(RTRIM(Gear)) AS Gear, Summary_ID, Teeth,
       Date_Added, Status, Emp_ID, Roll_Master_Needed
FROM dbo.tblGEAR
ORDER BY Gear_ID;
"@

  "pinions.json" = @"
SELECT Pinion_ID, LTRIM(RTRIM(Pinion)) AS Pinion, Summary_ID, Teeth,
       Date_Added, Status, Emp_ID, Roll_Master_Needed
FROM dbo.tblPINION
ORDER BY Pinion_ID;
"@
}

foreach ($entry in $queries.GetEnumerator()) {
  $path = Join-Path $OutputDirectory $entry.Key
  Write-Host "Exporting $($entry.Key)..."
  $rows = Invoke-Sqlcmd -ServerInstance $SqlServer -Database $Database -Query $entry.Value
  @($rows) | ConvertTo-Json -Depth 6 | Set-Content -Path $path -Encoding UTF8
}

Write-Host "Base/master data exported to $OutputDirectory"
