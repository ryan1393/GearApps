$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot


function Test-DockerVolume([string]$Name) {
    $Names = @(& { $ErrorActionPreference = 'Continue'; & docker volume ls --format "{{.Name}}" 2>$null })
    return ($Names -contains $Name)
}

function Ensure-DockerVolume([string]$Name) {
    if (-not (Test-DockerVolume $Name)) {
        & docker volume create $Name | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create Docker volume '$Name'."
        }
        Write-Host "[OK] Created Docker volume: $Name"
    }
    else {
        Write-Host "[OK] Docker volume exists: $Name"
    }
}

function Test-RxoCredentialFiles {
    if (-not (Test-DockerVolume "truck-log-rxo-credentials")) {
        return $false
    }

    & { $ErrorActionPreference = 'Continue'; & docker run --rm `
        -v truck-log-rxo-credentials:/secrets:ro `
        alpine:3.20 `
        sh -c "test -s /secrets/rxo_username && test -s /secrets/rxo_password" `
        *> $null }

    return ($LASTEXITCODE -eq 0)
}


Write-Host ""
Write-Host "RXO Export - Credential / Volume Setup"
Write-Host "--------------------------------------------"
Write-Host ""

Ensure-DockerVolume "truck-log-rxo-data"
Ensure-DockerVolume "truck-log-rxo-state"
Ensure-DockerVolume "truck-log-rxo-credentials"

Write-Host ""
$Username = Read-Host "RXO username"
$SecurePassword = Read-Host "RXO password" -AsSecureString

if ([string]::IsNullOrWhiteSpace($Username)) {
    throw "RXO username cannot be blank."
}

$Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)

try {
    $PlainPassword =
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr)

    if ([string]::IsNullOrWhiteSpace($PlainPassword)) {
        throw "RXO password cannot be blank."
    }

    # Pass values through STDIN rather than command-line arguments.
    $Username |
        & docker run --rm -i `
            -v truck-log-rxo-credentials:/secrets `
            alpine:3.20 `
            sh -c "tr -d '\r\n' > /secrets/rxo_username && chmod 600 /secrets/rxo_username"

    if ($LASTEXITCODE -ne 0) {
        throw "Could not store RXO username in Docker credential volume."
    }

    $PlainPassword |
        & docker run --rm -i `
            -v truck-log-rxo-credentials:/secrets `
            alpine:3.20 `
            sh -c "tr -d '\r\n' > /secrets/rxo_password && chmod 600 /secrets/rxo_password"

    if ($LASTEXITCODE -ne 0) {
        throw "Could not store RXO password in Docker credential volume."
    }
}
finally {
    if ($Ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr)
    }
    $PlainPassword = $null
}

if (-not (Test-RxoCredentialFiles)) {
    throw "Credential files were not verified after writing them."
}

Write-Host ""
Write-Host "[OK] RXO credentials verified inside Docker."
Write-Host ""
Write-Host "Next:"
Write-Host "  TEST-RXO-INTEGRATION.cmd"
