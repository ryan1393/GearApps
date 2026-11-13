$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$Destination = Join-Path $PSScriptRoot "shipment-link-diagnostic"

if (Test-Path $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$TempName = "rxo-link-diag-" + [Guid]::NewGuid().ToString("N")

try {
    & { $ErrorActionPreference = 'Continue'; & docker create `
        --name $TempName `
        -v truck-log-rxo-data:/data:ro `
        alpine:3.20 `
        sh -c "sleep 300" *> $null }

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create temporary diagnostic container."
    }

    $LatestBatch = (
        & docker exec $TempName `
            sh -c "if [ -d /data/batches ]; then ls -1t /data/batches | head -1; fi"
    ).Trim()

    if ([string]::IsNullOrWhiteSpace($LatestBatch)) {
        throw "No RXO batch exists."
    }

    $Base = "/data/batches/$LatestBatch"

    & docker cp `
        "${TempName}:${Base}/source-all/ShipmentsData.xlsx" `
        (Join-Path $Destination "ShipmentsData.xlsx")

    & docker cp `
        "${TempName}:${Base}/source-all/OrdersData.xlsx" `
        (Join-Path $Destination "OrdersData.xlsx")

    & { $ErrorActionPreference = 'Continue'; & docker cp `
        "${TempName}:${Base}/operational/fort-wayne/shipment-link-diagnostic.json" `
        (Join-Path $Destination "shipment-link-diagnostic.json") `
        2>$null }

    & { $ErrorActionPreference = 'Continue'; & docker cp `
        "${TempName}:${Base}/operational/fort-wayne/normalization-report.json" `
        (Join-Path $Destination "normalization-report.json") `
        2>$null }
}
finally {
    & { $ErrorActionPreference = 'Continue'; & docker rm -f $TempName *> $null }
}

Write-Host ""
Write-Host "[OK] Shipment-link diagnostic files copied to:"
Write-Host "     $Destination"
Write-Host ""

Get-ChildItem $Destination |
    Select-Object Name,Length,LastWriteTime |
    Format-Table -AutoSize
