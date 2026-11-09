$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$Destination = Join-Path $PSScriptRoot "exported-failure"

if (Test-Path $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$TempName = "rxo-failure-copy-" + [Guid]::NewGuid().ToString("N")

try {
    & { $ErrorActionPreference = 'Continue'; & docker create `
        --name $TempName `
        -v truck-log-rxo-data:/data:ro `
        alpine:3.20 `
        sh -c "sleep 300" *> $null }

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create temporary Docker copy container."
    }

    $LatestFailure = (
        & docker exec $TempName `
            sh -c "if [ -d /data/failed ]; then ls -1t /data/failed | head -1; fi"
    ).Trim()

    if ([string]::IsNullOrWhiteSpace($LatestFailure)) {
        throw "No RXO failure diagnostic folder exists yet."
    }

    & docker cp `
        "${TempName}:/data/failed/$LatestFailure/." `
        "$Destination"

    if ($LASTEXITCODE -ne 0) {
        throw "Could not copy RXO failure diagnostics to Windows."
    }
}
finally {
    & { $ErrorActionPreference = 'Continue'; & docker rm -f $TempName *> $null }
}

Write-Host ""
Write-Host "[OK] Latest RXO failure diagnostics copied to:"
Write-Host "     $Destination"
Write-Host ""
Get-ChildItem $Destination |
    Select-Object Name,Length,LastWriteTime |
    Format-Table -AutoSize
