param(
    [switch]$Compact
)

$rows = @(
    [pscustomobject]@{ Command='npm run setup:gear-apps'; Purpose='Install dependencies, reset Nx, and verify the workspace.'; Safety='SAFE' },
    [pscustomobject]@{ Command='npm run start:gear-apps'; Purpose='Start API, Blade Tracking, Cutter Builder, and Green Shed.'; Safety='SAFE' },
    [pscustomobject]@{ Command='npm run configure:label-printer'; Purpose='Set the IPL serial-tag printer host/port in .env (does not print).'; Safety='SAFE' },
    [pscustomobject]@{ Command='npm run test:gear-apps'; Purpose='Run the master MeshForge test suite.'; Safety='SAFE by default' },
    [pscustomobject]@{ Command='npm run validate:base-data'; Purpose='Validate Excel-derived summary/blade/cutter reference data.'; Safety='SAFE' },
    [pscustomobject]@{ Command='npm run test:data-import'; Purpose='Validate the fresh SQL Server + Excel import contract.'; Safety='SAFE' },
    [pscustomobject]@{ Command='npm run test:blade-data'; Purpose='Create/verify dedicated Blade Tracking E2E data.'; Safety='TEST DATA' },
    [pscustomobject]@{ Command='npm run test:cutter-dana'; Purpose='Preflight the MF-to-Dana cutter assignment test.'; Safety='SAFE by default' },
    [pscustomobject]@{ Command='npm run import:all-fresh'; Purpose='Fresh-read SQL Server + merge Excel data + validate/stage snapshots.'; Safety='SAFE / NO PostgreSQL writes' },
    [pscustomobject]@{ Command='npm run import:all-fresh:apply'; Purpose='Apply fresh SQL Server + Excel base data, then refresh cutter history.'; Safety='WRITES PostgreSQL' },
    [pscustomobject]@{ Command='npm run export:base:fresh'; Purpose='Fresh SQL Server base/master export only.'; Safety='READ-ONLY SQL Server' },
    [pscustomobject]@{ Command='npm run export:cutter-history:fresh'; Purpose='Fresh SQL Server cutter-history export only.'; Safety='READ-ONLY SQL Server' },
    [pscustomobject]@{ Command='npm run import:base-data'; Purpose='Import the currently staged base/reference package.'; Safety='WRITES PostgreSQL' },
    [pscustomobject]@{ Command='npm run import:cutter-history:snapshot'; Purpose='Dry-run the currently staged cutter-history snapshot.'; Safety='SAFE / dry-run' }
)

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' MeshForge Command Center' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

if ($Compact) {
    foreach ($row in $rows) {
        $color = if ($row.Safety -like 'WRITES*') {'Red'} elseif ($row.Safety -like 'TEST*') {'Yellow'} else {'Green'}
        Write-Host ("  {0,-40} {1}" -f $row.Command, $row.Purpose) -ForegroundColor $color
    }
} else {
    $rows | Format-Table -AutoSize
}

Write-Host ''
Write-Host 'Recommended fresh migration sequence:' -ForegroundColor Cyan
Write-Host '  1. npm run setup:gear-apps'
Write-Host '  2. npm run validate:base-data'
Write-Host '  3. npm run test:data-import'
Write-Host '  4. npm run import:all-fresh'
Write-Host '  5. Review the fresh SQL/Excel preflight output'
Write-Host '  6. npm run import:all-fresh:apply   <-- writes PostgreSQL' -ForegroundColor Yellow
Write-Host '  7. npm run start:gear-apps'
Write-Host '  8. npm run test:gear-apps'
Write-Host ''
