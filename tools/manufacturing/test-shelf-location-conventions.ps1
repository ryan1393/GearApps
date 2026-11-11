param(
    [string]$BaseUrl = "http://localhost:3333/api/v1",
    [string]$Email = "test@meshforge.local",
    [string]$Password,
    [Parameter(Mandatory=$true)] [string]$SummaryNumber,
    [Parameter(Mandatory=$true)] [ValidateSet('RING','PINION')] [string]$PartTypeCode
)

$ErrorActionPreference = 'Stop'
$summary = $SummaryNumber.Trim().ToUpper()
$partType = $PartTypeCode.Trim().ToUpper()
if (-not $summary) { throw 'SummaryNumber is required.' }
$greenshedPrefix = if ($partType -eq 'RING') { 'GSR' } else { 'GSP' }
$cuttergrindPart = if ($partType -eq 'RING') { 'R' } else { 'P' }
$greenshedTag = "$greenshedPrefix-$summary"

if (-not $Password) {
    $secure = Read-Host "Password for $Email" -AsSecureString
    $Password = [System.Net.NetworkCredential]::new('', $secure).Password
}
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/email/login" -ContentType 'application/json' -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
if (-not $login.accessToken) { throw 'Authentication did not return an access token.' }
$headers = @{ Authorization = "Bearer $($login.accessToken)" }

$expected = @(
    @{ Tag=$greenshedTag; Department='GREENSHED';   Name="Green Shed $partType" },
    @{ Tag="CGD$cuttergrindPart-$summary"; Department='CUTTERGRIND'; Name="Cuttergrind Dull $partType" },
    @{ Tag="CGF$cuttergrindPart-$summary"; Department='CUTTERGRIND'; Name="Cuttergrind Finished $partType" }
)

$results = @()
foreach ($item in $expected) {
    $tag = $item.Tag
    try {
        $location = Invoke-RestMethod -Method Get -Uri "$BaseUrl/locations/scan/$([uri]::EscapeDataString($tag))" -Headers $headers
        $checks = @(
            @{ Name='serial_number'; Actual=$location.serial_number; Expected=$tag },
            @{ Name='number'; Actual=$location.number; Expected=$summary },
            @{ Name='department'; Actual=$location.department; Expected=$item.Department },
            @{ Name='location_type'; Actual=$location.location_type; Expected='SHELF' }
        )
        foreach ($check in $checks) {
            if ([string]$check.Actual -ne [string]$check.Expected) {
                throw "$($check.Name) expected '$($check.Expected)' but got '$($check.Actual)'"
            }
        }
        Write-Host "[PASS] $($item.Name) $tag -> Summary $summary / $($item.Department) / SHELF" -ForegroundColor Green
        $results += [pscustomobject]@{ shelf=$item.Name; tag=$tag; status='PASS' }
    } catch {
        Write-Host "[FAIL] $($item.Name) $tag - $($_.Exception.Message)" -ForegroundColor Red
        $results += [pscustomobject]@{ shelf=$item.Name; tag=$tag; status='FAIL'; detail=$_.Exception.Message }
    }
}

try {
    $lower = $greenshedTag.ToLower()
    $location = Invoke-RestMethod -Method Get -Uri "$BaseUrl/locations/scan/$([uri]::EscapeDataString($lower))" -Headers $headers
    if ($location.serial_number -ne $greenshedTag) { throw "normalized serial_number was '$($location.serial_number)'" }
    Write-Host "[PASS] Scanner normalization $lower -> $greenshedTag" -ForegroundColor Green
    $results += [pscustomobject]@{ shelf='Scanner normalization'; tag=$lower; status='PASS' }
} catch {
    Write-Host "[FAIL] Scanner normalization - $($_.Exception.Message)" -ForegroundColor Red
    $results += [pscustomobject]@{ shelf='Scanner normalization'; tag=$greenshedTag.ToLower(); status='FAIL'; detail=$_.Exception.Message }
}

$failed = @($results | Where-Object status -eq 'FAIL').Count
$results | Format-Table -AutoSize
if ($failed -gt 0) {
    Write-Host "[FAIL] $failed shelf-location convention check(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host '[PASS] GSR- / GSP- / CGDR- / CGDP- / CGFR- / CGFP- shelf-location conventions are valid.' -ForegroundColor Green
exit 0
