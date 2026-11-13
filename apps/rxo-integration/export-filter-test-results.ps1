$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$Destination = Join-Path $PSScriptRoot "filter-test-results"

if (Test-Path $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$TempName = "rxo-filter-copy-" + [Guid]::NewGuid().ToString("N")

try {
    & { $ErrorActionPreference = 'Continue'; & docker create `
        --name $TempName `
        -v truck-log-rxo-data:/data:ro `
        alpine:3.20 `
        sh -c "sleep 300" *> $null }

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create temporary copy container."
    }

    $Latest = (
        & docker exec $TempName `
            sh -c "if [ -d /data/filter-tests ]; then ls -1t /data/filter-tests | grep -v latest-summary.json | head -1; fi"
    ).Trim()

    if ([string]::IsNullOrWhiteSpace($Latest)) {
        throw "No filter-test result folder exists."
    }

    & docker cp `
        "${TempName}:/data/filter-tests/$Latest/." `
        "$Destination"

    if ($LASTEXITCODE -ne 0) {
        throw "Could not copy filter-test results."
    }
}
finally {
    & { $ErrorActionPreference = 'Continue'; & docker rm -f $TempName *> $null }
}

Write-Host ""
Write-Host "[OK] Filter-test results copied to:"
Write-Host "     $Destination"
Write-Host ""
Write-Host "Send me summary.json plus the failure screenshot if any page fails."
