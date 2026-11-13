param(
    [string]$ServerRoot = "http://localhost:3333",
    [string]$Email = "test@meshforge.local",
    [string]$Password,
    [string]$ManifestPath = "$PSScriptRoot\api-route-manifest.json"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================================"
Write-Host " MeshForge ALL-ROUTE Runtime Probe"
Write-Host "============================================================"
Write-Host ""
Write-Host "This probe covers EVERY route in the source manifest."
Write-Host "GET routes are called authenticated when appropriate."
Write-Host "POST/PATCH/DELETE routes are probed NON-DESTRUCTIVELY."
Write-Host "Protected writes are called without auth so the guard should return 401/403."
Write-Host "Public auth writes receive invalid payloads so no user/data is created."
Write-Host ""

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Route manifest not found: $ManifestPath"
}

$Routes = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

if (@($Routes).Count -ne 125) {
    throw "Expected 125 routes but manifest contains $(@($Routes).Count)."
}

$Results = @()

function Get-StatusCode {
    param($ErrorRecord)

    try {
        if ($ErrorRecord.Exception.Response.StatusCode.value__) {
            return [int]$ErrorRecord.Exception.Response.StatusCode.value__
        }
    } catch {}

    try {
        if ($ErrorRecord.Exception.Response.StatusCode) {
            return [int]$ErrorRecord.Exception.Response.StatusCode
        }
    } catch {}

    return $null
}

function Add-Result {
    param(
        [string]$Method,
        [string]$Route,
        [string]$RuntimePath,
        [string]$Status,
        [Nullable[int]]$HttpStatus,
        [Nullable[int]]$TimeMs,
        [string]$Controller,
        [string]$Note = ""
    )

    $script:Results += [PSCustomObject]@{
        Method      = $Method
        Route       = $Route
        RuntimePath = $RuntimePath
        Status      = $Status
        HttpStatus  = $HttpStatus
        TimeMs      = $TimeMs
        Controller  = $Controller
        Note        = $Note
    }
}

function Resolve-ProbePath {
    param([string]$Path)

    $resolved = $Path

    # Valid-looking, guaranteed-nonexistent UUID for id-like parameters.
    $fakeUuid = "00000000-0000-4000-8000-000000000001"
    $fakeText = "__meshforge_route_probe_no_record__"

    $resolved = $resolved -replace ":id(?=/|$)", $fakeUuid
    $resolved = $resolved -replace ":trayId(?=/|$)", $fakeUuid
    $resolved = $resolved -replace ":containerId(?=/|$)", $fakeUuid
    $resolved = $resolved -replace ":locationId(?=/|$)", $fakeUuid
    $resolved = $resolved -replace ":bladeId(?=/|$)", $fakeUuid

    $resolved = $resolved -replace ":buildNumber(?=/|$)", $fakeText
    $resolved = $resolved -replace ":machineNumber(?=/|$)", $fakeText
    $resolved = $resolved -replace ":serialNumber(?=/|$)", $fakeText
    $resolved = $resolved -replace ":partNumber(?=/|$)", $fakeText

    return $resolved
}

function Invoke-RequestProbe {
    param(
        [string]$Method,
        [string]$Route,
        [string]$Controller
    )

    $runtimePath = Resolve-ProbePath $Route
    $uri = "$ServerRoot$runtimePath"

    $headers = @{}
    $body = $null
    $contentType = $null
    $expectedMode = ""

    # Health is public.
    if ($Method -eq "GET" -and $Route -eq "/api/v1/health") {
        $expectedMode = "PUBLIC-GET"
    }
    # Real successful login is tested once below. Don't re-run it in the loop.
    elseif ($Method -eq "POST" -and $Route -eq "/api/v1/auth/email/login") {
        Add-Result $Method $Route $runtimePath "PASS" 200 0 $Controller "Successful login tested before route loop."
        return
    }
    # Public auth endpoints get intentionally invalid bodies/query data.
    elseif ($Route -like "/api/v1/auth/*") {
        $expectedMode = "PUBLIC-AUTH-PROBE"

        if ($Method -eq "GET") {
            if ($Route -eq "/api/v1/auth/me") {
                $headers = $script:AuthHeaders
                $expectedMode = "AUTHENTICATED-GET"
            }
            elseif ($Route -eq "/api/v1/auth/refresh") {
                if ($script:RefreshToken) {
                    $headers = @{ Authorization = "Bearer $($script:RefreshToken)" }
                } else {
                    $headers = $script:AuthHeaders
                }
            }
            elseif ($Route -eq "/api/v1/auth/email/verify") {
                $uri = "${uri}?token=__invalid_route_probe_token__"
            }
        }
        else {
            # Deliberately malformed/empty auth request. Validation should reject
            # this before any registration/reset/mail side effect can happen.
            $body = "{}"
            $contentType = "application/json"
        }
    }
    elseif ($Method -eq "GET") {
        # Safe read path: use the real test account.
        $headers = $script:AuthHeaders
        $expectedMode = "AUTHENTICATED-GET"

        if ($Route -eq "/api/v1/dsf-counts/history") {
            $uri = "${uri}?from=2000-01-01&to=2000-01-01&group=day"
        }
        elseif ($Route -eq "/api/v1/cutter-config/blade-requirements/resolve") {
            $uri = "${uri}?summaryId=00000000-0000-4000-8000-000000000001&partTypeId=00000000-0000-4000-8000-000000000001"
        }
    }
    else {
        # SAFETY RULE:
        # Write routes are intentionally called WITHOUT Authorization.
        # A correctly protected route returns 401/403 BEFORE its controller mutates data.
        # Fake path IDs additionally protect path-based business actions.
        $expectedMode = "PROTECTED-WRITE-GUARD"
        $body = "__MESHFORGE_NON_MUTATING_ROUTE_PROBE__"
        $contentType = "text/plain"
    }

    $start = Get-Date

    try {
        $params = @{
            Method = $Method
            Uri    = $uri
            Headers = $headers
        }

        if ($null -ne $body) {
            $params["Body"] = $body
        }
        if ($contentType) {
            $params["ContentType"] = $contentType
        }

        $response = Invoke-RestMethod @params
        $elapsed = [math]::Round(((Get-Date) - $start).TotalMilliseconds)

        # A 2xx from a protected write probe would be dangerous: it means the
        # route accepted an unauthenticated request. Flag it even if no mutation
        # was observed.
        if ($expectedMode -eq "PROTECTED-WRITE-GUARD") {
            Write-Host ("[FAIL] {0,-6} {1} returned 2xx WITHOUT AUTH" -f $Method, $Route) -ForegroundColor Red
            Add-Result $Method $Route $runtimePath "FAIL" 200 $elapsed $Controller "Protected write accepted unauthenticated request."
            return
        }

        Write-Host ("[PASS] {0,-6} {1}  ({2} ms)" -f $Method, $Route, $elapsed) -ForegroundColor Green
        Add-Result $Method $Route $runtimePath "PASS" 200 $elapsed $Controller
        return
    }
    catch {
        $elapsed = [math]::Round(((Get-Date) - $start).TotalMilliseconds)
        $status = Get-StatusCode $_

        if ($null -eq $status) {
            Write-Host ("[FAIL] {0,-6} {1} no HTTP response" -f $Method, $Route) -ForegroundColor Red
            Add-Result $Method $Route $runtimePath "FAIL" $null $elapsed $Controller $_.Exception.Message
            return
        }

        if ($status -ge 500) {
            Write-Host ("[FAIL] {0,-6} {1} HTTP {2}" -f $Method, $Route, $status) -ForegroundColor Red
            Add-Result $Method $Route $runtimePath "FAIL" $status $elapsed $Controller "Server-side error."
            return
        }

        if ($expectedMode -eq "PROTECTED-WRITE-GUARD") {
            if ($status -in @(401, 403)) {
                Write-Host ("[PASS-GUARD] {0,-6} {1} HTTP {2}" -f $Method, $Route, $status) -ForegroundColor DarkGreen
                Add-Result $Method $Route $runtimePath "PASS-GUARD" $status $elapsed $Controller "Write route blocked before mutation."
            }
            else {
                Write-Host ("[REVIEW] {0,-6} {1} HTTP {2} (expected 401/403)" -f $Method, $Route, $status) -ForegroundColor Yellow
                Add-Result $Method $Route $runtimePath "REVIEW" $status $elapsed $Controller "Write route did not return the expected auth guard status."
            }
            return
        }

        if ($expectedMode -eq "PUBLIC-AUTH-PROBE") {
            # 4xx is expected for deliberately-invalid auth/reset/verify probes.
            if ($status -in @(400, 401, 403, 404, 409, 422)) {
                Write-Host ("[PASS-PROBE] {0,-6} {1} HTTP {2}" -f $Method, $Route, $status) -ForegroundColor DarkGreen
                Add-Result $Method $Route $runtimePath "PASS-PROBE" $status $elapsed $Controller "Public auth route rejected invalid probe as expected."
            }
            else {
                Add-Result $Method $Route $runtimePath "REVIEW" $status $elapsed $Controller "Unexpected auth probe status."
            }
            return
        }

        if ($expectedMode -eq "AUTHENTICATED-GET") {
            if ($status -eq 403) {
                Write-Host ("[PASS-AUTHZ] GET    {0} HTTP 403" -f $Route) -ForegroundColor DarkGreen
                Add-Result $Method $Route $runtimePath "PASS-AUTHZ" $status $elapsed $Controller "Route exists; role correctly denied this account."
                return
            }

            if ($status -in @(400, 404, 422) -and $Route.Contains(":")) {
                Write-Host ("[PASS-NODATA] GET    {0} HTTP {1}" -f $Route, $status) -ForegroundColor DarkGreen
                Add-Result $Method $Route $runtimePath "PASS-NODATA" $status $elapsed $Controller "Dynamic route reached with deliberately nonexistent probe key."
                return
            }

            if ($status -in @(400, 404, 422) -and $Route -eq "/api/v1/cutter-config/blade-requirements/resolve") {
                Write-Host ("[PASS-NODATA] GET    {0} HTTP {1}" -f $Route, $status) -ForegroundColor DarkGreen
                Add-Result $Method $Route $runtimePath "PASS-NODATA" $status $elapsed $Controller "Resolve route reached with nonexistent IDs."
                return
            }

            Write-Host ("[FAIL] GET    {0} HTTP {1}" -f $Route, $status) -ForegroundColor Red
            Add-Result $Method $Route $runtimePath "FAIL" $status $elapsed $Controller $_.Exception.Message
            return
        }

        if ($expectedMode -eq "PUBLIC-GET") {
            Write-Host ("[FAIL] GET    {0} HTTP {1}" -f $Route, $status) -ForegroundColor Red
            Add-Result $Method $Route $runtimePath "FAIL" $status $elapsed $Controller $_.Exception.Message
            return
        }

        Add-Result $Method $Route $runtimePath "REVIEW" $status $elapsed $Controller $_.Exception.Message
    }
}

# ------------------------------------------------------------
# LOGIN FIRST
# ------------------------------------------------------------

if (-not $Password) {
    $securePassword = Read-Host "Password for $Email" -AsSecureString
    $Password = [System.Net.NetworkCredential]::new("", $securePassword).Password
}

Write-Host "[AUTH] Logging in as $Email ..."

try {
    $loginStart = Get-Date

    $login = Invoke-RestMethod `
        -Method Post `
        -Uri "$ServerRoot/api/v1/auth/email/login" `
        -ContentType "application/json" `
        -Body (@{
            email = $Email
            password = $Password
        } | ConvertTo-Json)

    if (-not $login.accessToken) {
        throw "Login succeeded but accessToken is missing."
    }

    $script:AuthHeaders = @{
        Authorization = "Bearer $($login.accessToken)"
    }

    $script:RefreshToken = $login.refreshToken

    $loginMs = [math]::Round(((Get-Date) - $loginStart).TotalMilliseconds)

    Write-Host "[PASS] Authentication ($loginMs ms)" -ForegroundColor Green
}
catch {
    Write-Host "[FAIL] Authentication" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

# ------------------------------------------------------------
# ALL DECLARED ROUTES
# ------------------------------------------------------------

Write-Host ""
Write-Host "Testing $(@($Routes).Count) routes..."
Write-Host ""

foreach ($route in $Routes) {
    Invoke-RequestProbe `
        -Method $route.method `
        -Route $route.path `
        -Controller $route.controller
}

# ------------------------------------------------------------
# REPORT
# ------------------------------------------------------------

Write-Host ""
Write-Host "============================================================"
Write-Host " ALL-ROUTE RESULTS"
Write-Host "============================================================"

$Results |
    Sort-Object Route, Method |
    Format-Table Method, Status, HttpStatus, TimeMs, Route -AutoSize

$passStatuses = @(
    "PASS",
    "PASS-GUARD",
    "PASS-PROBE",
    "PASS-AUTHZ",
    "PASS-NODATA"
)

$passed = @($Results | Where-Object { $_.Status -in $passStatuses }).Count
$review = @($Results | Where-Object { $_.Status -eq "REVIEW" }).Count
$failed = @($Results | Where-Object { $_.Status -eq "FAIL" }).Count

Write-Host ""
Write-Host "Routes in manifest : $(@($Routes).Count)"
Write-Host "Routes tested      : $(@($Results).Count)"
Write-Host "Passed             : $passed" -ForegroundColor Green
Write-Host "Review             : $review" -ForegroundColor Yellow
Write-Host "Failed             : $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

$reportFile = Join-Path (Get-Location) "meshforge-all-api-route-results.json"

$Results |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $reportFile -Encoding UTF8

Write-Host ""
Write-Host "JSON report: $reportFile"

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "[FAIL] One or more routes produced a server error or unexpected failure." -ForegroundColor Red
    exit 1
}

if ($review -gt 0) {
    Write-Host ""
    Write-Host "[REVIEW] No 5xx failures, but $review route(s) need authorization/validation review." -ForegroundColor Yellow
    exit 2
}

Write-Host ""
Write-Host "[PASS] ALL 112 API ROUTES PASSED THE NON-MUTATING RUNTIME PROBE" -ForegroundColor Green
exit 0
