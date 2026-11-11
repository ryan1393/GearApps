param(
    [string]$BaseUrl = "http://localhost:3333/api/v1",
    [string]$Email = "test@meshforge.local",
    [string]$Password,
    [Parameter(Mandatory=$true)] [string]$SummaryNumber,
    [Parameter(Mandatory=$true)] [ValidateSet('RING','PINION')] [string]$PartTypeCode,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$summary = $SummaryNumber.Trim().ToUpper()
$partType = $PartTypeCode.Trim().ToUpper()
if (-not $summary) { throw 'SummaryNumber is required.' }
if ($summary -notmatch '^(?=.*\d)[A-Z0-9.-]+$') { throw "Summary '$SummaryNumber' is not valid for a shelf tag." }
$greenshedPrefix = if ($partType -eq 'RING') { 'GSR' } else { 'GSP' }
$cuttergrindPart = if ($partType -eq 'RING') { 'R' } else { 'P' }

if (-not $Password) {
    $secure = Read-Host "Password for $Email" -AsSecureString
    $Password = [System.Net.NetworkCredential]::new('', $secure).Password
}
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/email/login" -ContentType 'application/json' -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
if (-not $login.accessToken) { throw 'Authentication did not return an access token.' }
$headers = @{ Authorization = "Bearer $($login.accessToken)" }

$definitions = @(
    @{ Tag="$greenshedPrefix-$summary"; Department='GREENSHED'; Description="Green Shed $partType cutter shelf for Summary $summary" },
    @{ Tag="CGD$cuttergrindPart-$summary"; Department='CUTTERGRIND'; Description="Cuttergrind dull $partType shelf for Summary $summary" },
    @{ Tag="CGF$cuttergrindPart-$summary"; Department='CUTTERGRIND'; Description="Cuttergrind finished $partType shelf for Summary $summary" }
)

foreach ($item in $definitions) {
    $found = $null
    try { $found = Invoke-RestMethod -Method Get -Uri "$BaseUrl/locations/scan/$([uri]::EscapeDataString($item.Tag))" -Headers $headers }
    catch { try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = $null }; if ($status -ne 404) { throw } }
    if ($found) {
        if ($found.number -ne $summary -or $found.department -ne $item.Department -or $found.location_type -ne 'SHELF') { throw "Existing $($item.Tag) does not match the required Summary/department/SHELF metadata." }
        Write-Host "[OK] $($item.Tag) already exists." -ForegroundColor Green
        continue
    }
    if (-not $Execute) { Write-Host "[MISSING] $($item.Tag) - would create with -Execute" -ForegroundColor Yellow; continue }
    $body = @{ serial_number=$item.Tag; number=$summary; description=$item.Description; department=$item.Department; location_type='SHELF'; enabled=$true } | ConvertTo-Json
    $created = Invoke-RestMethod -Method Post -Uri "$BaseUrl/locations" -Headers $headers -ContentType 'application/json' -Body $body
    if ($created.serial_number -ne $item.Tag -or $created.number -ne $summary -or $created.department -ne $item.Department -or $created.location_type -ne 'SHELF') { throw "Created location $($item.Tag) did not return the expected normalized values." }
    Write-Host "[CREATED] $($item.Tag)" -ForegroundColor Green
}

if (-not $Execute) { Write-Host 'No locations were created. Re-run with -Execute to create missing summary shelves.' -ForegroundColor Cyan }
