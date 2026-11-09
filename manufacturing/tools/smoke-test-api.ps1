param(
    [string]$BaseUrl = "http://localhost:3333/api/v1",
    [string]$Email = "test@gearapps.local",
    [string]$Password,
    [switch]$ShowResponses
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===================================================="
Write-Host " GearApps READ-ONLY API Smoke Test"
Write-Host "===================================================="
Write-Host "Base URL: $BaseUrl"
Write-Host ""

$Results = @()
$Responses = @{}

function Add-Result {
    param(
        [string]$Area,
        [string]$Name,
        [string]$Method,
        [string]$Path,
        [string]$Status,
        [Nullable[int]]$HttpStatus,
        [Nullable[int]]$TimeMs,
        [string]$Note = ""
    )

    $script:Results += [PSCustomObject]@{
        Area       = $Area
        Test       = $Name
        Method     = $Method
        Endpoint   = $Path
        Status     = $Status
        HttpStatus = $HttpStatus
        TimeMs     = $TimeMs
        Note       = $Note
    }
}

function Get-HttpStatus {
    param($ErrorRecord)

    try {
        if ($ErrorRecord.Exception.Response.StatusCode) {
            return [int]$ErrorRecord.Exception.Response.StatusCode
        }
    } catch {}

    try {
        if ($ErrorRecord.Exception.Response.StatusCode.value__) {
            return [int]$ErrorRecord.Exception.Response.StatusCode.value__
        }
    } catch {}

    return $null
}

function Get-FirstPropertyValue {
    param(
        $Object,
        [string[]]$Names,
        [int]$Depth = 0
    )

    if ($null -eq $Object -or $Depth -gt 8) {
        return $null
    }

    if ($Object -is [string] -or
        $Object -is [ValueType]) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        foreach ($name in $Names) {
            foreach ($key in $Object.Keys) {
                if ([string]::Equals([string]$key, $name, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $v = $Object[$key]
                    if ($null -ne $v -and [string]$v -ne "") {
                        return $v
                    }
                }
            }
        }

        foreach ($key in $Object.Keys) {
            $found = Get-FirstPropertyValue -Object $Object[$key] -Names $Names -Depth ($Depth + 1)
            if ($null -ne $found) {
                return $found
            }
        }

        return $null
    }

    $props = @($Object.PSObject.Properties)

    foreach ($name in $Names) {
        $p = $props | Where-Object {
            [string]::Equals($_.Name, $name, [System.StringComparison]::OrdinalIgnoreCase)
        } | Select-Object -First 1

        if ($p -and $null -ne $p.Value -and [string]$p.Value -ne "") {
            return $p.Value
        }
    }

    if ($Object -is [System.Collections.IEnumerable]) {
        foreach ($item in $Object) {
            $found = Get-FirstPropertyValue -Object $item -Names $Names -Depth ($Depth + 1)
            if ($null -ne $found) {
                return $found
            }
        }
    }

    foreach ($p in $props) {
        if ($p.Name -in @("Count", "Length", "Keys", "Values")) {
            continue
        }

        $found = Get-FirstPropertyValue -Object $p.Value -Names $Names -Depth ($Depth + 1)
        if ($null -ne $found) {
            return $found
        }
    }

    return $null
}

function Get-FirstEnabledCollectionItem {
    param($Object)

    if ($null -eq $Object) {
        return $null
    }

    $items = @()
    $dataProperty = @($Object.PSObject.Properties) | Where-Object {
        [string]::Equals($_.Name, "data", [System.StringComparison]::OrdinalIgnoreCase)
    } | Select-Object -First 1

    if ($dataProperty) {
        $items = @($dataProperty.Value)
    }
    elseif ($Object -is [System.Collections.IEnumerable] -and -not ($Object -is [string])) {
        $items = @($Object)
    }
    else {
        $items = @($Object)
    }

    foreach ($item in $items) {
        if ($null -eq $item) {
            continue
        }

        $enabledProperty = @($item.PSObject.Properties) | Where-Object {
            [string]::Equals($_.Name, "enabled", [System.StringComparison]::OrdinalIgnoreCase)
        } | Select-Object -First 1

        if ($enabledProperty -and $enabledProperty.Value -eq $false) {
            continue
        }

        return $item
    }

    return $null
}

function Invoke-GearGet {
    param(
        [string]$Area,
        [string]$Name,
        [string]$Path,
        [int[]]$ExpectedStatus = @(200),
        [switch]$NoAuth,
        [switch]$Optional
    )

    $url = "$BaseUrl$Path"
    $headers = @{}

    if (-not $NoAuth) {
        $headers = $script:AuthHeaders
    }

    $start = Get-Date

    try {
        $response = Invoke-RestMethod `
            -Method Get `
            -Uri $url `
            -Headers $headers

        $ms = [math]::Round(((Get-Date) - $start).TotalMilliseconds)

        if ($ExpectedStatus -contains 200) {
            Write-Host ("[PASS] {0,-34} {1,5} ms  {2}" -f $Name, $ms, $Path) -ForegroundColor Green
            Add-Result $Area $Name "GET" $Path "PASS" 200 $ms
            $script:Responses[$Name] = $response

            if ($ShowResponses) {
                $response | ConvertTo-Json -Depth 8 | Write-Host
            }

            return $response
        }

        Write-Host ("[FAIL] {0,-34} unexpected HTTP 200  {1}" -f $Name, $Path) -ForegroundColor Red
        Add-Result $Area $Name "GET" $Path "FAIL" 200 $ms "Expected: $($ExpectedStatus -join ',')"
        return $response
    }
    catch {
        $ms = [math]::Round(((Get-Date) - $start).TotalMilliseconds)
        $status = Get-HttpStatus $_

        if ($ExpectedStatus -contains $status) {
            $label = if ($status -eq 403) { "PASS-AUTHZ" } else { "PASS" }
            $note = if ($status -eq 403) {
                "Endpoint exists and correctly rejected this non-admin account."
            } else {
                "Expected HTTP $status"
            }

            Write-Host ("[{0}] {1,-30} HTTP {2}  {3}" -f $label, $Name, $status, $Path) -ForegroundColor DarkGreen
            Add-Result $Area $Name "GET" $Path $label $status $ms $note
            return $null
        }

        if ($Optional -and $status -eq 404) {
            Write-Host ("[SKIP] {0,-34} no matching record  {1}" -f $Name, $Path) -ForegroundColor Yellow
            Add-Result $Area $Name "GET" $Path "SKIP" $status $ms "No matching source record."
            return $null
        }

        Write-Host ("[FAIL] {0,-34} HTTP {1}  {2}" -f $Name, $status, $Path) -ForegroundColor Red
        Add-Result $Area $Name "GET" $Path "FAIL" $status $ms $_.Exception.Message
        return $null
    }
}

# ------------------------------------------------------------
# 1. Public server check
# ------------------------------------------------------------

Write-Host "---- SERVER ----"
$health = Invoke-GearGet `
    -Area "Server" `
    -Name "Health" `
    -Path "/health" `
    -NoAuth

# ------------------------------------------------------------
# 2. Login
# ------------------------------------------------------------

Write-Host ""
Write-Host "---- AUTHENTICATION ----"

if (-not $Email) {
    $Email = Read-Host "Email"
}

if (-not $Password) {
    $secure = Read-Host "Password for $Email" -AsSecureString
    $Password = [System.Net.NetworkCredential]::new("", $secure).Password
}

try {
    $loginStart = Get-Date

    $login = Invoke-RestMethod `
        -Method Post `
        -Uri "$BaseUrl/auth/email/login" `
        -ContentType "application/json" `
        -Body (@{
            email    = $Email
            password = $Password
        } | ConvertTo-Json)

    $loginMs = [math]::Round(((Get-Date) - $loginStart).TotalMilliseconds)

    if (-not $login.accessToken) {
        throw "Login returned no accessToken."
    }

    $script:AuthHeaders = @{
        Authorization = "Bearer $($login.accessToken)"
    }

    Write-Host ("[PASS] Authentication                     {0,5} ms" -f $loginMs) -ForegroundColor Green
    Add-Result "Auth" "Authentication" "POST" "/auth/email/login" "PASS" 200 $loginMs

}
catch {
    $status = Get-HttpStatus $_
    Write-Host "[FAIL] Authentication - HTTP $status" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Add-Result "Auth" "Authentication" "POST" "/auth/email/login" "FAIL" $status $null $_.Exception.Message

    $Results | Format-Table -AutoSize
    exit 1
}

$me = Invoke-GearGet `
    -Area "Auth" `
    -Name "Current User" `
    -Path "/auth/me"

# ------------------------------------------------------------
# 3. Core Cutter Tracking / Greenshed
# ------------------------------------------------------------

Write-Host ""
Write-Host "---- CUTTER BUILDER ----"

$cutterDashboard = Invoke-GearGet "Cutter Builder" "Cutter Builder Dashboard" "/cutter-builder/dashboard"
$cutterBodies    = Invoke-GearGet "Cutter Builder" "Cutter Bodies" "/cutter-builder/cutter-bodies"
$cutterBuilds    = Invoke-GearGet "Cutter Builder" "Cutter Builder Builds" "/cutter-builder/builds"

$cutterSerial = Get-FirstPropertyValue $cutterBodies @(
    "serialNumber", "serial_number", "cutterBodySerial", "cutter_body_serial"
)

if ($cutterSerial) {
    $encoded = [uri]::EscapeDataString([string]$cutterSerial)
    Invoke-GearGet "Cutter Builder" "Cutter Body Scan" "/cutter-builder/cutter-bodies/scan/$encoded" | Out-Null
} else {
    Add-Result "Cutter Builder" "Cutter Body Scan" "GET" "/cutter-builder/cutter-bodies/scan/:serialNumber" "SKIP" $null $null "No cutter serial found."
    Write-Host "[SKIP] Cutter Body Scan                   no source serial" -ForegroundColor Yellow
}

$buildNumber = Get-FirstPropertyValue $cutterBuilds @(
    "buildNumber", "build_number", "build"
)

if ($buildNumber) {
    $encodedBuild = [uri]::EscapeDataString([string]$buildNumber)

    Invoke-GearGet "Cutter Builder" "Cutter Builder Build Detail" "/cutter-builder/builds/$encodedBuild" | Out-Null
    Invoke-GearGet "Cutter Builder" "Cutter Card" "/cutter-builder/builds/$encodedBuild/card" | Out-Null

    # Not every build has a teardown. 404 is valid for this optional relationship.
    Invoke-GearGet `
        -Area "Cutter Builder" `
        -Name "Cutter Teardown" `
        -Path "/cutter-builder/teardowns/$encodedBuild" `
        -Optional | Out-Null
} else {
    foreach ($name in @("Cutter Builder Build Detail", "Cutter Card", "Cutter Teardown")) {
        Add-Result "Cutter Builder" $name "GET" "dynamic build route" "SKIP" $null $null "No build number found."
    }
    Write-Host "[SKIP] Cutter Builder dynamic build routes   no source build" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "---- GREENSHED ----"

$greenDashboard = Invoke-GearGet "Greenshed" "Greenshed Dashboard" "/greenshed/dashboard"
$referenceData  = Invoke-GearGet "Greenshed" "Greenshed Reference Data" "/greenshed/reference-data"
$running        = Invoke-GearGet "Greenshed" "Running Machines" "/greenshed/running-machines"
$greenBuilds    = Invoke-GearGet "Greenshed" "Greenshed Builds" "/greenshed/builds"

$greenBuildNumber = Get-FirstPropertyValue $greenBuilds @(
    "buildNumber", "build_number", "build"
)

if (-not $greenBuildNumber) {
    $greenBuildNumber = $buildNumber
}

if ($greenBuildNumber) {
    $encodedBuild = [uri]::EscapeDataString([string]$greenBuildNumber)
    Invoke-GearGet "Greenshed" "Greenshed Build Detail" "/greenshed/builds/$encodedBuild" | Out-Null
    Invoke-GearGet "Greenshed" "Greenshed Build History" "/greenshed/history/$encodedBuild" | Out-Null
} else {
    Add-Result "Greenshed" "Greenshed Build Detail" "GET" "/greenshed/builds/:buildNumber" "SKIP" $null $null "No build number found."
    Add-Result "Greenshed" "Greenshed Build History" "GET" "/greenshed/history/:buildNumber" "SKIP" $null $null "No build number found."
    Write-Host "[SKIP] Greenshed dynamic build routes     no source build" -ForegroundColor Yellow
}

$machineNumber = Get-FirstPropertyValue $running @(
    "machineNumber", "machine_number", "machine"
)

if ($machineNumber) {
    $encodedMachine = [uri]::EscapeDataString([string]$machineNumber)
    Invoke-GearGet "Greenshed" "Greenshed Machine Detail" "/greenshed/machines/$encodedMachine" | Out-Null
} else {
    Add-Result "Greenshed" "Greenshed Machine Detail" "GET" "/greenshed/machines/:machineNumber" "SKIP" $null $null "No machine number found."
    Write-Host "[SKIP] Greenshed Machine Detail           no source machine" -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 4. Shared Cutter Reference Data
# ------------------------------------------------------------

Write-Host ""
Write-Host "---- CUTTER REFERENCE DATA ----"

$parts       = Invoke-GearGet "Reference" "Parts" "/parts"
$partTypes   = Invoke-GearGet "Reference" "Part Types" "/part-types"
$summaries   = Invoke-GearGet "Reference" "Part Summaries" "/part-summaries"
$rollMasters = Invoke-GearGet "Reference" "Roll Masters" "/roll-masters"

Invoke-GearGet "Reference" "Cutter Config Part Types" "/cutter-config/part-types" | Out-Null
$requirements = Invoke-GearGet "Reference" "Blade Requirements" "/cutter-config/blade-requirements"

$partNumber = Get-FirstPropertyValue $parts @(
    "partNumber", "part_number", "number"
)

if ($partNumber) {
    $encodedPart = [uri]::EscapeDataString([string]$partNumber)
    Invoke-GearGet "Reference" "Part By Number" "/parts/number/$encodedPart" | Out-Null
} else {
    Add-Result "Reference" "Part By Number" "GET" "/parts/number/:partNumber" "SKIP" $null $null "No part number found."
    Write-Host "[SKIP] Part By Number                     no source part" -ForegroundColor Yellow
}

$summaryId = Get-FirstPropertyValue $requirements @(
    "summaryId", "summary_id", "partSummaryId", "part_summary_id"
)

$partTypeId = Get-FirstPropertyValue $requirements @(
    "partTypeId", "part_type_id"
)

if ($summaryId -and $partTypeId) {
    $resolvePath = "/cutter-config/blade-requirements/resolve?summaryId=$([uri]::EscapeDataString([string]$summaryId))&partTypeId=$([uri]::EscapeDataString([string]$partTypeId))"
    Invoke-GearGet "Reference" "Resolve Blade Requirement" $resolvePath | Out-Null
} else {
    Add-Result "Reference" "Resolve Blade Requirement" "GET" "/cutter-config/blade-requirements/resolve" "SKIP" $null $null "No requirement pair found."
    Write-Host "[SKIP] Resolve Blade Requirement          no source requirement pair" -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 5. Blade Tracking
#
# Collection endpoints below are ADMIN-only in the current API.
# A normal USER account returning 403 is considered a PASS-AUTHZ because
# that verifies the route + guard without changing data.
# ------------------------------------------------------------

Write-Host ""
Write-Host "---- BLADE TRACKING ----"

$blades = Invoke-GearGet `
    -Area "Blade Tracking" `
    -Name "Blades Collection" `
    -Path "/blades" `
    -ExpectedStatus @(200, 403)

$bladeTrays = Invoke-GearGet `
    -Area "Blade Tracking" `
    -Name "Blade Trays Collection" `
    -Path "/bladeTrays" `
    -ExpectedStatus @(200, 403)

$trays = Invoke-GearGet `
    -Area "Blade Tracking" `
    -Name "Trays Collection" `
    -Path "/trays" `
    -ExpectedStatus @(200, 403)

$containers = Invoke-GearGet `
    -Area "Blade Tracking" `
    -Name "Containers Collection" `
    -Path "/containers" `
    -ExpectedStatus @(200, 403)

$containerTrays = Invoke-GearGet `
    -Area "Blade Tracking" `
    -Name "Container Trays Collection" `
    -Path "/containerTrays" `
    -ExpectedStatus @(200, 403)

$locations = Invoke-GearGet `
    -Area "Blade Tracking" `
    -Name "Locations Collection" `
    -Path "/locations" `
    -ExpectedStatus @(200, 403)

$locationTrays = Invoke-GearGet `
    -Area "Blade Tracking" `
    -Name "Location Trays Collection" `
    -Path "/locationTrays" `
    -ExpectedStatus @(200, 403)

# If this account is ADMIN and the collections were readable, test the
# corresponding USER-accessible detail routes dynamically.

$bladeId = Get-FirstPropertyValue $blades @("id")
if ($bladeId) {
    Invoke-GearGet "Blade Tracking" "Blade Detail" "/blades/$bladeId" | Out-Null
    Invoke-GearGet "Blade Tracking" "Blade History" "/blades/$bladeId/history" | Out-Null
}

$trayId = Get-FirstPropertyValue $trays @("id")
if ($trayId) {
    Invoke-GearGet "Blade Tracking" "Tray Detail" "/trays/$trayId" | Out-Null
    Invoke-GearGet "Blade Tracking" "Tray Readiness" "/trays/$trayId/readiness" | Out-Null
    Invoke-GearGet "Blade Tracking" "Tray Grinding Runs" "/trays/$trayId/grinding-runs" | Out-Null
    Invoke-GearGet "Blade Tracking" "Active Blades In Tray" "/bladeTrays/tray/$trayId/active" | Out-Null
    Invoke-GearGet "Blade Tracking" "Current Container For Tray" "/containerTrays/tray/$trayId/current" -Optional | Out-Null
    Invoke-GearGet "Blade Tracking" "Current Location For Tray" "/locationTrays/tray/$trayId/current" -Optional | Out-Null
}

$containerId = Get-FirstPropertyValue $containers @("id")
$activeContainer = Get-FirstEnabledCollectionItem -Object $containers
$containerSerial = Get-FirstPropertyValue $activeContainer @("serialNumber", "serial_number")
if ($containerId) {
    Invoke-GearGet "Blade Tracking" "Container Detail" "/containers/$containerId" | Out-Null
    Invoke-GearGet "Blade Tracking" "Active Trays In Container" "/containerTrays/container/$containerId/active" | Out-Null
}
if ($containerSerial) {
    $encodedContainer = [uri]::EscapeDataString([string]$containerSerial)
    Invoke-GearGet "Blade Tracking" "Container Scan" "/containers/scan/$encodedContainer" | Out-Null
} else {
    Add-Result "Blade Tracking" "Container Scan" "GET" "/containers/scan/:serialNumber" "SKIP" $null $null "No enabled container source record."
    Write-Host "[SKIP] Container Scan                     no enabled source serial" -ForegroundColor Yellow
}

$locationId = Get-FirstPropertyValue $locations @("id")
$activeLocation = Get-FirstEnabledCollectionItem -Object $locations
$locationSerial = Get-FirstPropertyValue $activeLocation @("serialNumber", "serial_number")
if ($locationId) {
    Invoke-GearGet "Blade Tracking" "Location Detail" "/locations/$locationId" | Out-Null
}
if ($locationSerial) {
    $encodedLocation = [uri]::EscapeDataString([string]$locationSerial)
    Invoke-GearGet "Blade Tracking" "Location Scan" "/locations/scan/$encodedLocation" | Out-Null
} else {
    Add-Result "Blade Tracking" "Location Scan" "GET" "/locations/scan/:serialNumber" "SKIP" $null $null "No enabled location source record."
    Write-Host "[SKIP] Location Scan                      no enabled source serial" -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 6. Admin-only Users API
# ------------------------------------------------------------

Write-Host ""
Write-Host "---- ADMIN AUTHORIZATION ----"

$users = Invoke-GearGet `
    -Area "Admin" `
    -Name "Users Collection" `
    -Path "/users" `
    -ExpectedStatus @(200, 403)

$userId = Get-FirstPropertyValue $users @("id")
if ($userId) {
    Invoke-GearGet "Admin" "User Detail" "/users/$userId" -ExpectedStatus @(200, 403) | Out-Null
}

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------

Write-Host ""
Write-Host "===================================================="
Write-Host " API SMOKE TEST RESULTS"
Write-Host "===================================================="

$Results | Format-Table Area, Test, Status, HttpStatus, TimeMs, Endpoint -AutoSize

$passed = @($Results | Where-Object { $_.Status -in @("PASS", "PASS-AUTHZ") }).Count
$failed = @($Results | Where-Object { $_.Status -eq "FAIL" }).Count
$skipped = @($Results | Where-Object { $_.Status -eq "SKIP" }).Count

Write-Host ""
Write-Host "Passed : $passed" -ForegroundColor Green
Write-Host "Skipped: $skipped" -ForegroundColor Yellow
Write-Host "Failed : $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

$reportPath = Join-Path (Get-Location) "gearapps-api-smoke-results.json"

$Results |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host ""
Write-Host "Report: $reportPath"

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "[PASS] ALL REQUIRED READ-ONLY API SMOKE TESTS PASSED" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "[FAIL] $failed REQUIRED API TEST(S) FAILED" -ForegroundColor Red
exit 1
