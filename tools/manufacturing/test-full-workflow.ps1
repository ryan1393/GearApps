param(
    [string]$BaseUrl = "http://localhost:3333/api/v1",
    [string]$Email = "test@meshforge.local",
    [string]$Password,

    [Parameter(Mandatory=$true)] [string]$TraySerialNumber,
    [Parameter(Mandatory=$true)] [string]$SummaryId,
    [Parameter(Mandatory=$true)] [string]$PartTypeId,
    [Parameter(Mandatory=$true)] [string]$ContainerSerialNumber,
    [Parameter(Mandatory=$true)] [string]$CutterBodySerialNumber,
    [Parameter(Mandatory=$true)] [string]$MachineNumber,
    [Parameter(Mandatory=$true)] [string]$PartNumber,
    [Parameter(Mandatory=$true)] [string]$WrongTypePartNumber,
    [Parameter(Mandatory=$true)] [string]$WrongTypeMachineNumber,
    [string]$ChangeoverReasonCode = 'CHANGEOVER',
    [Parameter(Mandatory=$true)] [string]$PullReasonCode,
    [Parameter(Mandatory=$true)] [string]$TeardownTraySerialNumber,

    [int]$GrindingScrapCount = 0,
    [int]$StartingPieceCount = 0,
    [int]$QualityPieceCount = 50,
    [int]$FinalPieceCount = 100,
    [ValidateSet('FC','CMM')] [string]$QualityCheckType = 'FC',
    [ValidateSet('PASS','FAIL','HOLD')] [string]$QualityResult = 'PASS',
    [int]$TeardownScrapCount = 0,
    [switch]$Execute,
    [switch]$ShowResponses
)

$ErrorActionPreference = 'Stop'

$Results = @()
$script:AuthHeaders = @{}
$script:LastResponse = $null
$script:BuildNumber = $null
$script:TestMarker = "AUTOMATED_E2E_WORKFLOW_TEST_$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
$script:SummaryNumber = $null
$script:CuttergrindFinishedShelf = $null
$script:CuttergrindDullShelf = $null
$script:GreenshedShelf = $null

function Add-Result {
    param([string]$Step,[string]$Status,[string]$Detail='')
    $script:Results += [pscustomobject]@{ Step=$Step; Status=$Status; Detail=$Detail }
    $color = if ($Status -eq 'PASS') { 'Green' } elseif ($Status -eq 'SKIP') { 'Yellow' } else { 'Red' }
    Write-Host ("[{0}] {1} {2}" -f $Status,$Step,$Detail) -ForegroundColor $color
}

function Fail-Test {
    param([string]$Step,[string]$Detail)
    Add-Result $Step 'FAIL' $Detail
    throw "$Step - $Detail"
}

function Get-HttpStatus {
    param($ErrorRecord)
    try { return [int]$ErrorRecord.Exception.Response.StatusCode } catch { return $null }
}

function Invoke-Api {
    param(
        [ValidateSet('GET','POST')] [string]$Method,
        [string]$Path,
        $Body = $null,
        [string]$Step
    )
    $uri = "$BaseUrl$Path"
    try {
        if ($Method -eq 'GET') {
            $response = Invoke-RestMethod -Method Get -Uri $uri -Headers $script:AuthHeaders
        } else {
            $json = if ($null -eq $Body) { '{}' } else { $Body | ConvertTo-Json -Depth 12 }
            $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $script:AuthHeaders -ContentType 'application/json' -Body $json
        }
        $script:LastResponse = $response
        if ($ShowResponses) { $response | ConvertTo-Json -Depth 12 | Write-Host }
        Add-Result $Step 'PASS' "$Method $Path"
        return $response
    } catch {
        $status = Get-HttpStatus $_
        $detail = $_.Exception.Message
        $bodyText = $null

        # PowerShell often exposes the server JSON here directly.
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $bodyText = [string]$_.ErrorDetails.Message
        }

        if (-not $bodyText) {
            try {
                $response = $_.Exception.Response
                if ($response) {
                    # PowerShell 7 / HttpResponseMessage.
                    if ($response.Content) {
                        $bodyText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                    }
                    # Windows PowerShell / WebResponse.
                    if (-not $bodyText -and $response.PSObject.Methods.Name -contains 'GetResponseStream') {
                        $stream = $response.GetResponseStream()
                        if ($stream) {
                            $reader = New-Object System.IO.StreamReader($stream)
                            $bodyText = $reader.ReadToEnd()
                            $reader.Dispose()
                        }
                    }
                }
            } catch {
                # Preserve the original exception if no response body is available.
            }
        }

        if ($bodyText) {
            $detail = "$detail | Response: $bodyText"
        }
        Fail-Test $Step "HTTP $status - $detail"
    }
}

function Invoke-ApiExpectFailure {
    param(
        [ValidateSet('POST')] [string]$Method,
        [string]$Path,
        $Body,
        [int[]]$ExpectedStatus = @(400,409,422),
        [string]$Step
    )
    $uri = "$BaseUrl$Path"
    try {
        $json = $Body | ConvertTo-Json -Depth 12
        $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $script:AuthHeaders -ContentType 'application/json' -Body $json
        if ($ShowResponses) { $response | ConvertTo-Json -Depth 12 | Write-Host }
    } catch {
        $status = Get-HttpStatus $_
        if ($ExpectedStatus -notcontains $status) {
            Fail-Test $Step "Expected HTTP $($ExpectedStatus -join '/') but got HTTP $status - $($_.Exception.Message)"
        }
        Add-Result $Step 'PASS' "Invalid shelf rejected with HTTP $status"
        return
    }
    Fail-Test $Step 'Request unexpectedly succeeded; invalid shelf convention was not rejected'
}

function Assert-Equal {
    param($Actual,$Expected,[string]$Step,[string]$Name)
    if ([string]$Actual -ne [string]$Expected) {
        Fail-Test $Step "$Name expected '$Expected' but got '$Actual'"
    }
    Add-Result $Step 'PASS' "$Name=$Actual"
}

function Assert-True {
    param([bool]$Condition,[string]$Step,[string]$Detail)
    if (-not $Condition) { Fail-Test $Step $Detail }
    Add-Result $Step 'PASS' $Detail
}

function Encode([string]$value) { return [uri]::EscapeDataString($value) }
function Normalize-Summary([string]$value) { return $value.Trim().ToUpper() }
function Get-ShelfTag([ValidateSet('GSR','GSP','CGDR','CGDP','CGFR','CGFP')] [string]$Prefix,[string]$SummaryNumber) {
    return "$Prefix-$(Normalize-Summary $SummaryNumber)"
}

Write-Host ''
Write-Host '============================================================'
Write-Host ' MeshForge FULL MUTATING WORKFLOW TEST'
Write-Host ' Blade Tracking -> Coater -> Cutter Builder -> Green Shed'
Write-Host ' -> Changeover to Greenshed Shelf -> Re-setup -> Pull -> Cutter Builder Teardown'
Write-Host '============================================================'
Write-Host ''
Write-Host 'WARNING: This test intentionally changes database state.' -ForegroundColor Yellow
Write-Host 'Use dedicated TEST tray/container/cutter/machine records only.' -ForegroundColor Yellow
Write-Host ''

if ($FinalPieceCount -lt $QualityPieceCount) {
    throw 'FinalPieceCount must be >= QualityPieceCount.'
}
if ($QualityPieceCount -lt $StartingPieceCount) {
    throw 'QualityPieceCount must be >= StartingPieceCount.'
}

if (-not $Password) {
    $secure = Read-Host "Password for $Email" -AsSecureString
    $Password = [System.Net.NetworkCredential]::new('', $secure).Password
}

# Public reachability
try {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" | Out-Null
    Add-Result 'Server health' 'PASS' $BaseUrl
} catch {
    Fail-Test 'Server health' 'API is not reachable. Start it with: npx nx serve meshforge-server'
}

# Login
try {
    $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/email/login" -ContentType 'application/json' -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
    if (-not $login.accessToken) { throw 'No accessToken returned.' }
    $script:AuthHeaders = @{ Authorization = "Bearer $($login.accessToken)" }
    Add-Result 'Authentication' 'PASS' $Email
} catch {
    Fail-Test 'Authentication' $_.Exception.Message
}

# --------------------------
# PRE-FLIGHT
# --------------------------
Write-Host ''
Write-Host '---- PRE-FLIGHT ----'
$tray = Invoke-Api GET "/trays/scan/$(Encode $TraySerialNumber)" $null 'Scan source tray'
$trayId = $tray.id
Assert-True ([bool]$trayId) 'Source tray ID' 'Source tray returned an id'
Assert-Equal $tray.current_stage.code 'WAITING_FOR_GRINDING' 'Source tray starting stage' 'current_stage.code'

$readiness = Invoke-Api GET "/trays/$trayId/readiness" $null 'Read source tray readiness'
Assert-True (-not [bool]$readiness.grinding_complete) 'Source tray not already ground' 'Source tray has not already completed grinding'

$container = Invoke-Api GET "/containers/scan/$(Encode $ContainerSerialNumber)" $null 'Scan coater container'
Assert-True ([bool]$container.id) 'Coater container ID' 'Container returned an id'

$cutterBody = Invoke-Api GET "/cutter-builder/cutter-bodies/scan/$(Encode $CutterBodySerialNumber)" $null 'Scan cutter body'
Assert-True ([bool]$cutterBody.id) 'Cutter body ID' 'Cutter body returned an id'

$bodyBuilds = Invoke-Api GET "/cutter-builder/builds?cutterBody=$(Encode $CutterBodySerialNumber)&limit=100" $null 'Check cutter body for open build'
$openBodyBuilds = @($bodyBuilds | Where-Object {
    $_.cutter_body_serial_number -eq $CutterBodySerialNumber.ToUpper() -and -not $_.completed_at
})
Assert-Equal $openBodyBuilds.Count 0 'Cutter body open-build check' 'open_build_count'

$refs = Invoke-Api GET '/greenshed/reference-data' $null 'Load Green Shed reference data'
$changeoverReason = @($refs.pull_reasons | Where-Object { $_.code -eq $ChangeoverReasonCode.ToUpper() }) | Select-Object -First 1
Assert-True ([bool]$changeoverReason) 'Changeover reason exists' "Reason $($ChangeoverReasonCode.ToUpper()) is enabled"
Assert-True (-not [bool]$changeoverReason.requires_teardown) 'Changeover reason teardown flag' 'Changeover reason does not require teardown'
Assert-True ([bool]$changeoverReason.returns_to_shelf) 'Changeover reason shelf flag' 'Changeover reason returns intact cutter to shelf'

$teardownReason = @($refs.pull_reasons | Where-Object { $_.code -eq $PullReasonCode.ToUpper() }) | Select-Object -First 1
Assert-True ([bool]$teardownReason) 'Teardown pull reason exists' "Reason $($PullReasonCode.ToUpper()) is enabled"
Assert-True ([bool]$teardownReason.requires_teardown) 'Teardown reason teardown flag' 'Teardown pull reason requires teardown'
Assert-True (-not [bool]$teardownReason.returns_to_shelf) 'Teardown reason shelf flag' 'Teardown pull reason does not return cutter intact to shelf'

$machine = Invoke-Api GET "/greenshed/machines/$(Encode $MachineNumber)" $null 'Check Green Shed machine'
Assert-True (-not $machine.active_run) 'Machine availability' 'Machine has no active cutter run'

$part = Invoke-Api GET "/parts/number/$(Encode $PartNumber)" $null 'Check production part'
Assert-True ([bool]$part.id) 'Production part ID' 'Part returned an id'
$workflowPartTypeCode = ([string]$part.part_type.code).Trim().ToUpper()
Assert-True ($workflowPartTypeCode -in @('RING','PINION')) 'Production part type' "Part Type=$workflowPartTypeCode"

$summary = Invoke-Api GET "/part-summaries/$(Encode $SummaryId)" $null 'Check workflow summary'
Assert-True ([bool]$summary.id) 'Summary ID' 'Summary returned an id'
$script:SummaryNumber = Normalize-Summary $summary.number
Assert-True ([bool]$script:SummaryNumber) 'Summary number' "Summary=$script:SummaryNumber"
$greenshedPrefix = if ($workflowPartTypeCode -eq 'RING') { 'GSR' } else { 'GSP' }
$cuttergrindDullPrefix = if ($workflowPartTypeCode -eq 'RING') { 'CGDR' } else { 'CGDP' }
$cuttergrindFinishedPrefix = if ($workflowPartTypeCode -eq 'RING') { 'CGFR' } else { 'CGFP' }
$script:GreenshedShelf = Get-ShelfTag $greenshedPrefix $script:SummaryNumber
$script:CuttergrindDullShelf = Get-ShelfTag $cuttergrindDullPrefix $script:SummaryNumber
$script:CuttergrindFinishedShelf = Get-ShelfTag $cuttergrindFinishedPrefix $script:SummaryNumber
Write-Host "Expected shelves: Green Shed $workflowPartTypeCode=$script:GreenshedShelf, Cuttergrind Dull=$script:CuttergrindDullShelf, Cuttergrind Finished=$script:CuttergrindFinishedShelf" -ForegroundColor Cyan

$greenshedShelfLocation = Invoke-Api GET "/locations/scan/$(Encode $script:GreenshedShelf)" $null 'Check Greenshed changeover shelf'
Assert-Equal $greenshedShelfLocation.location_type 'SHELF' 'Greenshed shelf type' 'location_type'
Assert-Equal $greenshedShelfLocation.department 'GREENSHED' 'Greenshed shelf department' 'department'
Assert-Equal $greenshedShelfLocation.number $script:SummaryNumber 'Greenshed shelf summary' 'number'
Assert-Equal $greenshedShelfLocation.serial_number $script:GreenshedShelf 'Greenshed shelf tag convention' 'serial_number'

$cutterShelf = Invoke-Api GET "/locations/scan/$(Encode $script:CuttergrindFinishedShelf)" $null 'Check Cuttergrind receive shelf'
Assert-Equal $cutterShelf.location_type 'SHELF' 'Cuttergrind shelf type' 'location_type'
Assert-Equal $cutterShelf.department 'CUTTERGRIND' 'Cuttergrind shelf department' 'department'
Assert-Equal $cutterShelf.number $script:SummaryNumber 'Cuttergrind finished shelf summary' 'number'
Assert-Equal $cutterShelf.serial_number $script:CuttergrindFinishedShelf 'Cuttergrind finished shelf tag convention' 'serial_number'

$teardownTray = Invoke-Api GET "/trays/scan/$(Encode $TeardownTraySerialNumber)" $null 'Scan teardown tray'
Assert-True ([bool]$teardownTray.id) 'Teardown tray ID' 'Teardown tray returned an id'
$teardownBlades = Invoke-Api GET "/bladeTrays/tray/$($teardownTray.id)/active" $null 'Check teardown tray is empty'
$teardownBladeCount = @($teardownBlades).Count
Assert-Equal $teardownBladeCount 0 'Teardown tray empty' 'active_blade_count'

$teardownShelf = Invoke-Api GET "/locations/scan/$(Encode $script:CuttergrindDullShelf)" $null 'Check teardown shelf'
Assert-Equal $teardownShelf.location_type 'SHELF' 'Teardown shelf type' 'location_type'
Assert-Equal $teardownShelf.department 'CUTTERGRIND' 'Teardown shelf department' 'department'
Assert-Equal $teardownShelf.number $script:SummaryNumber 'Cuttergrind dull shelf summary' 'number'
Assert-Equal $teardownShelf.serial_number $script:CuttergrindDullShelf 'Cuttergrind dull shelf tag convention' 'serial_number'

Write-Host ''
Write-Host 'Pre-flight passed.' -ForegroundColor Green
Write-Host 'The next phase will MUTATE workflow data.' -ForegroundColor Yellow
Write-Host "Test marker: $script:TestMarker" -ForegroundColor Cyan

if (-not $Execute) {
    Write-Host ''
    Write-Host '[SAFE STOP] No database changes were made.' -ForegroundColor Green
    Write-Host 'Re-run the SAME command with -Execute after confirming these are test records.' -ForegroundColor Cyan
    $Results | Format-Table -AutoSize
    exit 0
}

# --------------------------
# 1) BLADE TRACKING - grinding
# --------------------------
Write-Host ''
Write-Host '---- BLADE TRACKING: GRINDING ----'
$start = Invoke-Api POST "/trays/$trayId/start-grinding" @{} 'Start grinding'
Assert-Equal $start.stage 'GRINDING' 'Grinding stage' 'stage'

$grind = Invoke-Api POST "/trays/$trayId/complete-grinding" @{
    summary_id = $SummaryId
    part_type_id = $PartTypeId
    scrapped_blade_count = $GrindingScrapCount
} 'Complete grinding'
Assert-True ([bool]$grind.complete) 'Grinding complete quantity' 'Tray contains required post-grind blade quantity'

$grindingRuns = Invoke-Api GET "/trays/$trayId/grinding-runs" $null 'Verify grinding history'
Assert-True (@($grindingRuns).Count -gt 0) 'Grinding history exists' 'At least one grinding run exists'

# --------------------------
# 2) COATER round-trip
# --------------------------
Write-Host ''
Write-Host '---- BLADE TRACKING: COATER ROUND-TRIP ----'
$load = Invoke-Api POST '/containerTrays' @{
    tray_id = $trayId
    container_id = $container.id
    enabled = $true
} 'Load tray into coater container'
Assert-True ([bool]$load.id) 'Container assignment created' 'Container-tray assignment returned an id'

$currentContainer = Invoke-Api GET "/containerTrays/tray/$trayId/current" $null 'Verify tray is at coater'
Assert-True ([bool]$currentContainer) 'Coater assignment active' 'Tray has an active container assignment'

Invoke-ApiExpectFailure POST "/containerTrays/container/$($container.id)/tray/$trayId/unload" @{
    shelf_location_serial_number = $script:CuttergrindDullShelf
} @(422) 'Reject dull shelf for coated finished tray'

$stillAtCoater = Invoke-Api GET "/containerTrays/tray/$trayId/current" $null 'Verify rejected shelf did not unload tray'
Assert-True ([bool]$stillAtCoater) 'Rejected receive rollback' 'Tray remains assigned to the coater after invalid shelf attempt'

$receive = Invoke-Api POST "/containerTrays/container/$($container.id)/tray/$trayId/unload" @{
    shelf_location_serial_number = $script:CuttergrindFinishedShelf
} 'Receive coated tray to Cuttergrind Finished shelf'

$currentLocation = Invoke-Api GET "/locationTrays/tray/$trayId/current" $null 'Verify Cuttergrind Finished shelf movement'
$currentShelfSerial = $null
if ($currentLocation.location) { $currentShelfSerial = $currentLocation.location.serial_number }
if (-not $currentShelfSerial) { $currentShelfSerial = $currentLocation.location_serial_number }
Assert-Equal $currentShelfSerial $script:CuttergrindFinishedShelf 'Tray shelf after coating' 'shelf_serial_number'

$ready = Invoke-Api GET "/trays/$trayId/readiness" $null 'Verify tray ready for Cutter Builder'
Assert-True ([bool]$ready.complete) 'Cutter Builder readiness' 'Tray is complete and ready'

# --------------------------
# 3) CUTTER BUILDER
# --------------------------
Write-Host ''
Write-Host '---- CUTTER BUILDER: BUILD ----'
$build = Invoke-Api POST '/cutter-builder/builds' @{
    cutter_body_identifier = $CutterBodySerialNumber
    tray_serial_number = $TraySerialNumber
    honed = $false
    coated = $true
    comments = "$script:TestMarker | cutter build"
} 'Create cutter build'
$script:BuildNumber = $build.build.build_number
Assert-True ([bool]$script:BuildNumber) 'Build number created' "Build=$script:BuildNumber"
Assert-Equal $build.build.status_code 'READY' 'Build initial status' 'status_code'

$sourceTrayAfterBuild = Invoke-Api GET "/trays/scan/$(Encode $TraySerialNumber)" $null 'Verify source tray released'
Assert-Equal $sourceTrayAfterBuild.blade_count 0 'Source tray emptied by Cutter Builder' 'blade_count'

$buildDetail = Invoke-Api GET "/cutter-builder/builds/$(Encode $script:BuildNumber)" $null 'Verify Cutter Builder build detail'
Assert-Equal $buildDetail.status.code 'READY' 'Cutter Builder detail status' 'status.code'

# --------------------------
# 4) GREEN SHED run + QC
# --------------------------
Write-Host ''
Write-Host '---- GREEN SHED: RUN + QUALITY ----'

# Negative compatibility gates: these must fail before the valid setup is allowed.
Invoke-ApiExpectFailure POST '/greenshed/setup' @{
    build_number = $script:BuildNumber
    machine_number = $MachineNumber
    part_number = $WrongTypePartNumber
    shift = 'TEST'
    starting_piece_count = $StartingPieceCount
    comments = "$script:TestMarker | reject opposite part type"
} @(409) 'Reject PINION/RING part-number mismatch'

Invoke-ApiExpectFailure POST '/greenshed/setup' @{
    build_number = $script:BuildNumber
    machine_number = $WrongTypeMachineNumber
    part_number = $PartNumber
    shift = 'TEST'
    starting_piece_count = $StartingPieceCount
    comments = "$script:TestMarker | reject opposite machine type"
} @(409) 'Reject PINION/RING machine mismatch'

$setup = Invoke-Api POST '/greenshed/setup' @{
    build_number = $script:BuildNumber
    machine_number = $MachineNumber
    part_number = $PartNumber
    shift = 'TEST'
    starting_piece_count = $StartingPieceCount
    comments = "$script:TestMarker | initial machine setup"
} 'Setup cutter on machine'
Assert-Equal $setup.status_code 'RUNNING' 'Machine setup status' 'status_code'

$machineRunning = Invoke-Api GET "/greenshed/machines/$(Encode $MachineNumber)" $null 'Verify running machine state'
Assert-Equal $machineRunning.active_run.build_number $script:BuildNumber 'Machine active build' 'build_number'

$qualityBody = @{
    build_number = $script:BuildNumber
    check_type_code = $QualityCheckType
    result_code = $QualityResult
    piece_count = $QualityPieceCount
    comments = "$script:TestMarker | quality check"
}
if ($QualityCheckType -eq 'FC') { $qualityBody.frequency = @{ tooth_thickness = 1.0; total_fr = 1.0 } }
else { $qualityBody.cmm = @{ tooth_thickness = 1.0; total_fr = 1.0 } }

$qc = Invoke-Api POST '/greenshed/quality-check' $qualityBody 'Record quality check'
Assert-Equal $qc.result_code $QualityResult 'Quality result' 'result_code'
Assert-Equal $qc.piece_count $QualityPieceCount 'Quality piece count' 'piece_count'

$piece = Invoke-Api POST "/greenshed/machines/$(Encode $MachineNumber)/piece-count" @{
    piece_count = $FinalPieceCount
} 'Update machine piece count'
Assert-Equal $piece.current_piece_count $FinalPieceCount 'Final machine count' 'current_piece_count'

$historyBeforePull = Invoke-Api GET "/greenshed/history/$(Encode $script:BuildNumber)" $null 'Verify build event history before pull'
Assert-True (@($historyBeforePull).Count -ge 3) 'Build history populated' 'Build has build/setup/quality events'

# --------------------------
# 5) GREEN SHED changeover -> shelf
# --------------------------
Write-Host ''
Write-Host '---- GREEN SHED: CHANGEOVER TO SHELF ----'
Invoke-ApiExpectFailure POST '/greenshed/pull' @{
    build_number = $script:BuildNumber
    reason_code = $ChangeoverReasonCode
    shelf_location_serial_number = $script:CuttergrindFinishedShelf
    comments = "$script:TestMarker | intentional invalid changeover shelf"
} @(422) 'Reject Cuttergrind shelf for Green Shed changeover'

$machineAfterRejectedChangeover = Invoke-Api GET "/greenshed/machines/$(Encode $MachineNumber)" $null 'Verify rejected changeover did not release machine'
Assert-Equal $machineAfterRejectedChangeover.active_run.build_number $script:BuildNumber 'Rejected changeover rollback' 'build_number'

$changeover = Invoke-Api POST '/greenshed/pull' @{
    build_number = $script:BuildNumber
    reason_code = $ChangeoverReasonCode
    shelf_location_serial_number = $script:GreenshedShelf
    comments = "$script:TestMarker | changeover to Green Shed shelf"
} 'Changeover cutter back to Greenshed shelf'

Assert-True (-not [bool]$changeover.requires_teardown) 'Changeover teardown behavior' 'Changeover does not require teardown'
Assert-True ([bool]$changeover.returned_to_shelf) 'Changeover shelf behavior' 'Changeover returns cutter intact to shelf'
Assert-Equal $changeover.status_code 'SHELF' 'Changeover cutter status' 'status_code'
Assert-Equal $changeover.shelf_location $script:GreenshedShelf 'Changeover destination shelf' 'shelf_location'
Assert-Equal $changeover.final_piece_count $FinalPieceCount 'Changeover final piece count' 'final_piece_count'

$machineAfterChangeover = Invoke-Api GET "/greenshed/machines/$(Encode $MachineNumber)" $null 'Verify machine released after changeover'
Assert-True (-not $machineAfterChangeover.active_run) 'Machine released after changeover' 'Machine has no active run'

$buildOnShelf = Invoke-Api GET "/greenshed/builds/$(Encode $script:BuildNumber)" $null 'Verify cutter is on Greenshed shelf'
Assert-Equal $buildOnShelf.status_code 'SHELF' 'Build shelf status' 'status_code'
Assert-True ([bool]$buildOnShelf.shelf_location) 'Build shelf assignment exists' 'shelf_location'
Assert-Equal $buildOnShelf.shelf_location.serial_number $script:GreenshedShelf 'Build current Greenshed shelf' 'shelf_location.serial_number'

# --------------------------
# 6) GREEN SHED re-setup from shelf
# --------------------------
Write-Host ''
Write-Host '---- GREEN SHED: RE-SETUP FROM SHELF ----'
$resetup = Invoke-Api POST '/greenshed/setup' @{
    build_number = $script:BuildNumber
    machine_number = $MachineNumber
    part_number = $PartNumber
    shift = 'TEST'
    starting_piece_count = $FinalPieceCount
    comments = "$script:TestMarker | re-setup after changeover"
} 'Re-setup shelved cutter on machine'
Assert-Equal $resetup.status_code 'RUNNING' 'Re-setup status' 'status_code'

$machineRunningAgain = Invoke-Api GET "/greenshed/machines/$(Encode $MachineNumber)" $null 'Verify machine running after re-setup'
Assert-Equal $machineRunningAgain.active_run.build_number $script:BuildNumber 'Machine active build after re-setup' 'build_number'

$buildAfterResetup = Invoke-Api GET "/greenshed/builds/$(Encode $script:BuildNumber)" $null 'Verify Green Shed shelf assignment cleared after re-setup'
Assert-Equal $buildAfterResetup.status_code 'RUNNING' 'Build status after re-setup' 'status_code'
Assert-True ($null -eq $buildAfterResetup.shelf_location) 'Changeover shelf assignment cleared' 'No active Green Shed shelf assignment remains after re-setup'
Assert-True ([bool]$buildAfterResetup.machine_run) 'Machine assignment active after re-setup' 'Build has an active machine run after leaving the shelf'

# --------------------------
# 7) GREEN SHED teardown pull
# --------------------------
Write-Host ''
Write-Host '---- GREEN SHED: PULL FOR TEARDOWN ----'
$pull = Invoke-Api POST '/greenshed/pull' @{
    build_number = $script:BuildNumber
    reason_code = $PullReasonCode
    comments = "$script:TestMarker | teardown-required pull"
} 'Pull cutter from machine for teardown'

Assert-True ([bool]$pull.requires_teardown) 'Pull reason teardown behavior' 'Pull reason requires Cutter Builder teardown'
Assert-True (-not [bool]$pull.returned_to_shelf) 'Teardown pull shelf behavior' 'Teardown pull does not return intact cutter to shelf'
Assert-Equal $pull.status_code 'PULLED' 'Pulled cutter status' 'status_code'
Assert-Equal $pull.final_piece_count $FinalPieceCount 'Pull final piece count' 'final_piece_count'

$machineAfterPull = Invoke-Api GET "/greenshed/machines/$(Encode $MachineNumber)" $null 'Verify machine released after teardown pull'
Assert-True (-not $machineAfterPull.active_run) 'Machine released after teardown pull' 'Machine has no active run after pull'

# --------------------------
# 8) CUTTER BUILDER teardown
# --------------------------
Write-Host ''
Write-Host '---- CUTTER BUILDER: TEARDOWN ----'
Invoke-ApiExpectFailure POST '/cutter-builder/teardowns' @{
    build_number = $script:BuildNumber
    teardown_tray_serial_number = $TeardownTraySerialNumber
    shelf_location_serial_number = $script:CuttergrindFinishedShelf
    scrapped_blade_count = $TeardownScrapCount
    comments = "$script:TestMarker | intentional invalid teardown shelf"
} @(422) 'Reject finished shelf for dull teardown blades'

$buildStillPulled = Invoke-Api GET "/cutter-builder/builds/$(Encode $script:BuildNumber)" $null 'Verify rejected teardown did not close build'
Assert-Equal $buildStillPulled.status.code 'PULLED' 'Rejected teardown rollback' 'status.code'

$teardown = Invoke-Api POST '/cutter-builder/teardowns' @{
    build_number = $script:BuildNumber
    teardown_tray_serial_number = $TeardownTraySerialNumber
    shelf_location_serial_number = $script:CuttergrindDullShelf
    scrapped_blade_count = $TeardownScrapCount
    comments = "$script:TestMarker | Cutter Builder teardown"
} 'Teardown cutter'
Assert-True ([bool]$teardown.build_closed) 'Build closed' 'Teardown closed the cutter build'
Assert-Equal $teardown.shelf_location_serial_number $script:CuttergrindDullShelf 'Teardown shelf' 'shelf_location_serial_number'

$teardownRecord = Invoke-Api GET "/cutter-builder/teardowns/$(Encode $script:BuildNumber)" $null 'Verify teardown record'
Assert-True ([bool]$teardownRecord) 'Teardown history exists' 'Teardown record can be read back'

$teardownLocation = Invoke-Api GET "/locationTrays/tray/$($teardownTray.id)/current" $null 'Verify teardown tray shelf movement'
$teardownCurrentShelf = $null
if ($teardownLocation.location) { $teardownCurrentShelf = $teardownLocation.location.serial_number }
if (-not $teardownCurrentShelf) { $teardownCurrentShelf = $teardownLocation.location_serial_number }
Assert-Equal $teardownCurrentShelf $script:CuttergrindDullShelf 'Teardown tray current shelf' 'shelf_serial_number'

$teardownActiveBlades = Invoke-Api GET "/bladeTrays/tray/$($teardownTray.id)/active" $null 'Verify returned blades are on teardown tray'
Assert-Equal @($teardownActiveBlades).Count $teardown.returned_blade_count 'Returned blade quantity' 'active_blade_count'

$finalHistory = Invoke-Api GET "/greenshed/history/$(Encode $script:BuildNumber)" $null 'Verify final cutter history'
$testEvents = @($finalHistory | Where-Object { $_.comments -like "$script:TestMarker*" })

Assert-Equal @($testEvents | Where-Object { $_.event_type.code -eq 'CB' }).Count 1 'History: cutter build event' 'CB_count'
Assert-Equal @($testEvents | Where-Object { $_.event_type.code -eq 'CS' }).Count 2 'History: setup events' 'CS_count'
Assert-Equal @($testEvents | Where-Object { $_.event_type.code -eq $QualityCheckType }).Count 1 'History: quality event' "$($QualityCheckType)_count"
Assert-Equal @($testEvents | Where-Object { $_.event_type.code -eq 'CC' }).Count 1 'History: changeover event' 'CC_count'
Assert-Equal @($testEvents | Where-Object { $_.event_type.code -eq 'CP' }).Count 1 'History: teardown pull event' 'CP_count'
Assert-Equal @($testEvents | Where-Object { $_.event_type.code -eq 'TD' }).Count 1 'History: teardown event' 'TD_count'
Assert-Equal $testEvents.Count 7 'History: complete marked lifecycle' 'marked_event_count'

$changeoverHistory = @($testEvents | Where-Object {
    $_.event_type.code -eq 'CC' -and $_.pull_reason.code -eq $ChangeoverReasonCode.ToUpper()
})
Assert-Equal $changeoverHistory.Count 1 'History: changeover reason' 'matching_changeover_reason_count'

$pullHistory = @($testEvents | Where-Object {
    $_.event_type.code -eq 'CP' -and $_.pull_reason.code -eq $PullReasonCode.ToUpper()
})
Assert-Equal $pullHistory.Count 1 'History: teardown pull reason' 'matching_pull_reason_count'

Write-Host ''
Write-Host '============================================================'
Write-Host ' FULL WORKFLOW TEST RESULTS'
Write-Host '============================================================'
$Results | Format-Table -AutoSize

$failed = @($Results | Where-Object Status -eq 'FAIL').Count
$report = [pscustomobject]@{
    executed = $true
    test_marker = $script:TestMarker
    build_number = $script:BuildNumber
    source_tray = $TraySerialNumber
    summary_number = $script:SummaryNumber
    cuttergrind_finished_shelf = $script:CuttergrindFinishedShelf
    cuttergrind_dull_shelf = $script:CuttergrindDullShelf
    greenshed_changeover_shelf = $script:GreenshedShelf
    changeover_reason = $ChangeoverReasonCode
    teardown_tray = $TeardownTraySerialNumber
    machine = $MachineNumber
    part_number = $PartNumber
    passed = @($Results | Where-Object Status -eq 'PASS').Count
    failed = $failed
    results = $Results
}
$reportPath = Join-Path (Get-Location) 'meshforge-full-workflow-results.json'
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Report: $reportPath"

if ($failed -eq 0) {
    Write-Host ''
    Write-Host '[PASS] FULL MESHFORGE WORKFLOW COMPLETED SUCCESSFULLY' -ForegroundColor Green
    Write-Host "Build tested: $script:BuildNumber" -ForegroundColor Green
    exit 0
}

Write-Host "[FAIL] $failed workflow assertion(s) failed" -ForegroundColor Red
exit 1
