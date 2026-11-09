param(
    [string]$BaseUrl = "http://localhost:3333/api/v1",
    [string]$Email = "admin@gearapps.local",
    [Parameter(Mandatory=$true)][string]$Password,
    [switch]$Execute,
    [switch]$ShowResponses
)

$ErrorActionPreference = 'Stop'
$Results = @()

function Add-Result {
    param([string]$Test,[string]$Status,[string]$Detail='')
    $script:Results += [pscustomobject]@{ Test=$Test; Status=$Status; Detail=$Detail }
    $color = if ($Status -eq 'PASS') {'Green'} elseif ($Status -eq 'SKIP') {'Yellow'} else {'Red'}
    Write-Host ("[{0}] {1} {2}" -f $Status,$Test,$Detail) -ForegroundColor $color
}

function Assert-Equal {
    param($Actual,$Expected,[string]$Name)
    if ($Actual -ne $Expected) {
        throw "$Name expected '$Expected' but received '$Actual'."
    }
    Add-Result $Name 'PASS' "Value=$Actual"
}

function Assert-True {
    param([bool]$Condition,[string]$Name,[string]$Detail='')
    if (-not $Condition) { throw "$Name failed. $Detail" }
    Add-Result $Name 'PASS' $Detail
}

function Encode([string]$Value) {
    return [uri]::EscapeDataString($Value)
}

function Invoke-Json {
    param(
        [ValidateSet('GET','POST','PATCH')][string]$Method,
        [string]$Path,
        $Body = $null,
        [int[]]$ExpectedStatus = @(200,201)
    )

    $params = @{
        Method      = $Method
        Uri         = "$BaseUrl$Path"
        Headers     = $script:Headers
        ContentType = 'application/json'
    }
    if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 8) }

    try {
        $response = Invoke-WebRequest -UseBasicParsing @params
        if ($ExpectedStatus -notcontains [int]$response.StatusCode) {
            throw "Unexpected HTTP $($response.StatusCode) for $Method $Path"
        }
        $parsed = if ($response.Content) { $response.Content | ConvertFrom-Json } else { $null }
        if ($ShowResponses -and $null -ne $parsed) {
            $parsed | ConvertTo-Json -Depth 10 | Write-Host
        }
        return $parsed
    } catch {
        $status = $null
        if ($_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        }
        if ($null -ne $status -and $ExpectedStatus -contains $status) {
            Add-Result "$Method $Path" 'PASS' "Expected HTTP $status"
            return $null
        }
        throw
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Cutter Body ADMIN MF -> Dana Assignment Test" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Safe default: PRE-FLIGHT only. Add -Execute to create dedicated E2E cutter-body records." -ForegroundColor Yellow

# Authentication is safe/read-only and confirms the test can reach the API.
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/email/login" -ContentType 'application/json' -Body (@{
    email = $Email
    password = $Password
} | ConvertTo-Json)

if (-not $login.accessToken) {
    throw 'Authentication did not return an access token.'
}
$script:Headers = @{ Authorization = "Bearer $($login.accessToken)" }
Add-Result 'Authentication' 'PASS' $Email

if (-not $Execute) {
    Add-Result 'MF -> Dana mutation test' 'SKIP' 'Preflight passed; no database changes made.'
    Write-Host ""
    $Results | Format-Table -AutoSize
    Write-Host "[PASS] Cutter-body Dana assignment PRE-FLIGHT passed." -ForegroundColor Green
    exit 0
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff')
$mfSerial = "E2E-MF-$stamp"
$danaSerial = "E2E-DANA-$stamp"
$secondMfSerial = "E2E-MF-DUP-$stamp"

Write-Host "Test MF S/N:   $mfSerial" -ForegroundColor Cyan
Write-Host "Test Dana S/N: $danaSerial" -ForegroundColor Cyan

# 1. Create an unetched cutter: MF required, Dana omitted.
$created = Invoke-Json POST '/cutter-builder/cutter-bodies' @{
    mf_serial_number = $mfSerial
    description = 'E2E MF-to-Dana assignment test cutter'
}
Assert-True ([bool]$created.id) 'MF-only cutter created' "ID=$($created.id)"
Assert-Equal $created.mf_serial_number $mfSerial 'MF serial persisted'
Assert-True (-not $created.dana_serial_number) 'Dana starts unassigned' 'Unetched cutter has no Dana S/N'

# 2. MF lookup finds that exact physical cutter.
$byMf = Invoke-Json GET "/cutter-builder/cutter-bodies/scan/$(Encode $mfSerial)"
Assert-Equal $byMf.id $created.id 'MF lookup preserves cutter identity'

# 3. Assign Dana to the SAME cutter-body UUID.
$assigned = Invoke-Json PATCH "/cutter-builder/cutter-bodies/$($created.id)/dana-serial" @{
    dana_serial_number = $danaSerial
}
Assert-Equal $assigned.id $created.id 'Dana assignment preserves cutter UUID'
Assert-Equal $assigned.mf_serial_number $mfSerial 'MF serial preserved after etching'
Assert-Equal $assigned.dana_serial_number $danaSerial 'Dana serial assigned'

# 4. Both identifiers must resolve to the same cutter after etching.
$byDana = Invoke-Json GET "/cutter-builder/cutter-bodies/scan/$(Encode $danaSerial)"
Assert-Equal $byDana.id $created.id 'Dana lookup resolves original cutter'

$byMfAfter = Invoke-Json GET "/cutter-builder/cutter-bodies/scan/$(Encode $mfSerial)"
Assert-Equal $byMfAfter.id $created.id 'MF lookup still resolves original cutter'
Assert-Equal $byMfAfter.dana_serial_number $danaSerial 'MF lookup returns assigned Dana'

# 5. Duplicate Dana assignment must be rejected, never moved to another cutter.
$second = Invoke-Json POST '/cutter-builder/cutter-bodies' @{
    mf_serial_number = $secondMfSerial
    description = 'E2E duplicate-Dana guard test cutter'
}
Assert-True ([bool]$second.id) 'Second MF-only cutter created' "ID=$($second.id)"

Invoke-Json PATCH "/cutter-builder/cutter-bodies/$($second.id)/dana-serial" @{
    dana_serial_number = $danaSerial
} @(409) | Out-Null
Add-Result 'Duplicate Dana guard' 'PASS' 'Existing Dana S/N could not be reassigned.'

# 6. Verify failed duplicate attempt did not mutate either record.
$firstFinal = Invoke-Json GET "/cutter-builder/cutter-bodies/scan/$(Encode $danaSerial)"
Assert-Equal $firstFinal.id $created.id 'Original Dana ownership retained'

$secondFinal = Invoke-Json GET "/cutter-builder/cutter-bodies/scan/$(Encode $secondMfSerial)"
Assert-Equal $secondFinal.id $second.id 'Second cutter identity retained'
Assert-True (-not $secondFinal.dana_serial_number) 'Rejected duplicate leaves Dana blank' 'Second cutter remains unetched'

Write-Host ""
$Results | Format-Table -AutoSize
Write-Host "[PASS] MF -> Dana cutter-body assignment test passed." -ForegroundColor Green
Write-Host "Dedicated E2E cutter-body records were intentionally retained for audit/history." -ForegroundColor Yellow
