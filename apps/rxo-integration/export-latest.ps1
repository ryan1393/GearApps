$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$Destination = Join-Path $PSScriptRoot "exported-latest"

if (Test-Path $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$TempName = "rxo-export-copy-" + [Guid]::NewGuid().ToString("N")

try {
    & { $ErrorActionPreference = 'Continue'; & docker create `
        --name $TempName `
        -v truck-log-rxo-data:/data:ro `
        alpine:3.20 `
        sh -c "sleep 300" *> $null }

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create temporary copy container."
    }

    & docker cp `
        "${TempName}:/data/latest/." `
        "$Destination"

    if ($LASTEXITCODE -ne 0) {
        throw "Could not copy latest RXO output to Windows."
    }
}
finally {
    & { $ErrorActionPreference = 'Continue'; & docker rm -f $TempName *> $null }
}

Write-Host ""
Write-Host "[OK] Latest RXO output copied to:"
Write-Host "     $Destination"
Write-Host ""
Get-ChildItem $Destination -Recurse |
    Select-Object FullName,Length,LastWriteTime |
    Format-Table -AutoSize
