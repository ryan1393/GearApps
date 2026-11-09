param(
    [string]$BaseUrl = 'http://localhost:3333/api/v1',
    [Parameter(Mandatory=$true)] [string]$AdminEmail,
    [Parameter(Mandatory=$true)] [string]$AdminPassword,
    [Parameter(Mandatory=$true)] [string]$UserEmail,
    [Parameter(Mandatory=$true)] [string]$UserPassword,
    [Parameter(Mandatory=$true)] [string]$SummaryId,
    [Parameter(Mandatory=$true)] [string]$PartTypeId,
    [Parameter(Mandatory=$true)] [string]$OppositePartTypeId,
    [Parameter(Mandatory=$true)] [string]$RunToken,
    [Parameter(Mandatory=$true)] [string]$DirectContainerTrayId,
    [Parameter(Mandatory=$true)] [string]$DirectContainerId,
    [Parameter(Mandatory=$true)] [string]$DirectTrayId,
    [Parameter(Mandatory=$true)] [string]$TargetUserId,
    [switch]$ShowResponses
)

$ErrorActionPreference='Stop'
$Results=@()
$script:AdminHeaders=@{}
$script:UserHeaders=@{}

function Add-Result {
    param([string]$Step,[string]$Status,[string]$Detail='')
    $script:Results += [pscustomobject]@{Step=$Step;Status=$Status;Detail=$Detail}
    $color=if($Status -eq 'PASS'){'Green'}elseif($Status -eq 'SKIP'){'Yellow'}else{'Red'}
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

function Get-ErrorBody {
    param($ErrorRecord)
    $bodyText=$null
    if($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message){
        $bodyText=[string]$ErrorRecord.ErrorDetails.Message
    }
    if(-not $bodyText){
        try {
            $response=$ErrorRecord.Exception.Response
            if($response){
                if($response.Content){
                    $bodyText=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                }
                if(-not $bodyText -and $response.PSObject.Methods.Name -contains 'GetResponseStream'){
                    $stream=$response.GetResponseStream()
                    if($stream){
                        $reader=New-Object System.IO.StreamReader($stream)
                        $bodyText=$reader.ReadToEnd()
                        $reader.Dispose()
                    }
                }
            }
        } catch {}
    }
    return $bodyText
}

function Assert-True {
    param([bool]$Condition,[string]$Step,[string]$Detail)
    if(-not $Condition){ Fail-Test $Step $Detail }
    Add-Result $Step 'PASS' $Detail
}

function Assert-Equal {
    param($Actual,$Expected,[string]$Step,[string]$Name)
    if([string]$Actual -ne [string]$Expected){
        Fail-Test $Step "$Name expected '$Expected' but got '$Actual'"
    }
    Add-Result $Step 'PASS' "$Name=$Actual"
}

function Assert-NoRecord {
    param($Actual,[string]$Step,[string]$Detail)

    $isNoRecord = ($null -eq $Actual) -or (
        $Actual -is [string] -and [string]::IsNullOrWhiteSpace([string]$Actual)
    )

    if(-not $isNoRecord){
        $actualText = try { $Actual | ConvertTo-Json -Depth 12 -Compress } catch { [string]$Actual }
        Fail-Test $Step "$Detail. Unexpected record/response: $actualText"
    }

    Add-Result $Step 'PASS' $Detail
}

function Invoke-Api {
    param(
        [ValidateSet('GET','POST','PATCH','DELETE')] [string]$Method,
        [string]$Path,
        $Body=$null,
        [hashtable]$Headers=$script:AdminHeaders,
        [string]$Step
    )
    $uri="$BaseUrl$Path"
    try {
        $params=@{Method=$Method;Uri=$uri;Headers=$Headers}
        if($null -ne $Body){
            $params.ContentType='application/json'
            $params.Body=($Body|ConvertTo-Json -Depth 15)
        }
        $response=Invoke-RestMethod @params
        if($ShowResponses -and $null -ne $response){
            $response|ConvertTo-Json -Depth 15|Write-Host
        }
        Add-Result $Step 'PASS' "$Method $Path"
        return $response
    } catch {
        $status=Get-HttpStatus $_
        $body=Get-ErrorBody $_
        $detail=$_.Exception.Message
        if($body){$detail="$detail | Response: $body"}
        Fail-Test $Step "HTTP $status - $detail"
    }
}

function Invoke-ExpectFailure {
    param(
        [ValidateSet('GET','POST','PATCH','DELETE')] [string]$Method,
        [string]$Path,
        $Body=$null,
        [hashtable]$Headers=$script:AdminHeaders,
        [int[]]$ExpectedStatus,
        [string]$Step
    )
    $uri="$BaseUrl$Path"
    try {
        $params=@{Method=$Method;Uri=$uri;Headers=$Headers}
        if($null -ne $Body){
            $params.ContentType='application/json'
            $params.Body=($Body|ConvertTo-Json -Depth 15)
        }
        $response=Invoke-RestMethod @params
        Fail-Test $Step "Request unexpectedly succeeded: $($response|ConvertTo-Json -Depth 8 -Compress)"
    } catch {
        # Fail-Test itself throws; do not reinterpret our own deliberate failure.
        if($_.Exception.Message -like "$Step - *"){ throw }
        $status=Get-HttpStatus $_
        $bodyText=Get-ErrorBody $_
        if($ExpectedStatus -notcontains $status){
            Fail-Test $Step "Expected HTTP $($ExpectedStatus -join '/') but got HTTP $status. Response: $bodyText"
        }
        if(-not $bodyText){
            Fail-Test $Step "HTTP $status had no response body/error message"
        }
        $message=$null
        try {
            $parsed=$bodyText|ConvertFrom-Json
            if($parsed.message -is [array]){$message=($parsed.message -join '; ')}
            else{$message=[string]$parsed.message}
            if(-not $message -and $parsed.detail){$message=[string]$parsed.detail}
        } catch {
            $message=[string]$bodyText
        }
        if([string]::IsNullOrWhiteSpace($message)){
            Fail-Test $Step "HTTP $status response did not contain a useful error message: $bodyText"
        }
        Add-Result $Step 'PASS' "HTTP $status message='$message'"
        return @{status=$status;message=$message;body=$bodyText}
    }
}

function Login {
    param([string]$Email,[string]$Password,[string]$Step)
    try {
        $login=Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/email/login" -ContentType 'application/json' -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
        if(-not $login.accessToken){throw 'No accessToken returned'}
        Add-Result $Step 'PASS' $Email
        return @{Authorization="Bearer $($login.accessToken)"}
    } catch {
        $body=Get-ErrorBody $_
        Fail-Test $Step "$($_.Exception.Message) $body"
    }
}

$script:AssetSerialSequence = 0
function New-Token([string]$Prefix){ return "$Prefix-$RunToken-$([guid]::NewGuid().ToString('N').Substring(0,8))".ToUpper() }
function New-AssetSerial([ValidateSet('T','C')] [string]$Prefix){
    $script:AssetSerialSequence++
    $millis = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    return "$Prefix$millis$($script:AssetSerialSequence.ToString('00'))"
}

Write-Host ''
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host ' Gear Apps AUTHENTICATED BACKEND MUTATION TEST' -ForegroundColor Cyan
Write-Host ' Dedicated E2E records only - no production records are selected' -ForegroundColor Cyan
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host ''

# Server + authentication
try {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/health"|Out-Null
    Add-Result 'Server health' 'PASS' $BaseUrl
} catch { Fail-Test 'Server health' $_.Exception.Message }

$script:AdminHeaders=Login $AdminEmail $AdminPassword 'Admin authentication'
$script:UserHeaders=Login $UserEmail $UserPassword 'User authentication'

# Authentication / authorization failures must be explicit.
$unauthLocation=@{serial_number=(New-Token 'E2E-UNAUTH');number='E2E';description='must not create';department='E2E';location_type='INTERNAL';enabled=$true}
Invoke-ExpectFailure POST '/locations' $unauthLocation @{} @(401) 'Unauthenticated mutation rejected with message'|Out-Null
Invoke-ExpectFailure POST '/locations' $unauthLocation $script:UserHeaders @(403) 'Non-admin mutation rejected with message'|Out-Null

# Department-scoped application authorization:
# E2E user belongs to GEAR QUALITY, so Cutter Builder is dashboard-only.
$crossDepartmentDashboard=Invoke-Api GET '/cutter-builder/dashboard' $null $script:UserHeaders 'Cross-department Cutter Builder dashboard allowed'
Assert-True ($null -ne $crossDepartmentDashboard) 'Cross-department dashboard read' 'GEAR QUALITY user can view Cutter Builder dashboard'
Invoke-ExpectFailure POST '/cutter-builder/builds' @{
    cutter_body_identifier='__DEPARTMENT_GUARD_PROBE__'
    tray_serial_number='__DEPARTMENT_GUARD_PROBE__'
    honed=$false
    coated=$false
} $script:UserHeaders @(403) 'Cross-department Cutter Builder mutation rejected with message'|Out-Null

$nonAdminCutterSerial=New-Token 'E2E-NONADMIN-CUTTER'
$nonAdminCutter=@{
    mf_serial_number=$nonAdminCutterSerial
    description='must not create outside Admin'
}
Invoke-ExpectFailure POST '/cutter-builder/cutter-bodies' $nonAdminCutter $script:UserHeaders @(403) 'Non-admin cutter-body creation rejected with message'|Out-Null
Invoke-ExpectFailure GET "/cutter-builder/cutter-bodies/scan/$nonAdminCutterSerial" $null $script:UserHeaders @(404) 'Rejected non-admin cutter-body create left no record'|Out-Null

# Admin master-data creates used by the Administration screen.
$departments=@(Invoke-Api GET '/admin/master-data/departments' $null $script:AdminHeaders 'List admin departments')
Assert-True ($departments.Count -gt 0) 'Admin machine department fixture' 'At least one enabled department exists'

$adminUserEmail=("e2e-admin-created-$RunToken@example.local").ToLower()
$adminCreatedUser=Invoke-Api POST '/users' @{
    email=$adminUserEmail
    password='GearApps1!'
    firstName='E2E'
    lastName='Admin Created'
    role='admin'
    departmentId=$departments[0].id
} $script:AdminHeaders 'Create user from admin API'
Assert-True ([bool]$adminCreatedUser.id) 'Admin-created user id' 'POST /users returned an id'
Assert-Equal $adminCreatedUser.role 'admin' 'Verify admin-created user role' 'role'
Invoke-Api DELETE "/users/$($adminCreatedUser.id)" $null $script:AdminHeaders 'Delete admin-created user'|Out-Null

$adminModel=Invoke-Api POST '/admin/master-data/models' @{
    model_number=999999
    model_type=(New-Token 'E2E-MODEL')
    active=$true
} $script:AdminHeaders 'Create admin model'
Assert-True ([bool]$adminModel.id) 'Admin model id' 'Created model returned id'

$adminMachine=Invoke-Api POST '/admin/master-data/machines' @{
    machine_number=(New-Token 'E2E-MACHINE')
    department_id=$departments[0].id
    cell=99
    description='E2E admin master-data mutation'
    active=$true
} $script:AdminHeaders 'Create admin machine'
Assert-True ([bool]$adminMachine.id) 'Admin machine id' 'Created machine returned id'

Invoke-Api DELETE "/admin/master-data/machines/$($adminMachine.id)" $null $script:AdminHeaders 'Disable admin test machine'|Out-Null
Invoke-Api DELETE "/admin/master-data/models/$($adminModel.id)" $null $script:AdminHeaders 'Disable admin test model'|Out-Null

# Existing fixture target user: PATCH + DELETE admin-only routes.
$userUpdated=Invoke-Api PATCH "/users/$TargetUserId" @{firstName='E2E Updated';lastName='Mutation Target'} $script:AdminHeaders 'Update user'
Assert-Equal $userUpdated.firstName 'E2E Updated' 'Verify user update' 'firstName'
Invoke-Api DELETE "/users/$TargetUserId" $null $script:AdminHeaders 'Delete test user'|Out-Null

# Part summary CRUD
$summaryNumber=New-Token 'E2E-SUMMARY'
$summary=Invoke-Api POST '/part-summaries' @{number=$summaryNumber;revision='A';model_id=$null;hos='E2E';active=$true;enabled=$true} $script:AdminHeaders 'Create part summary'
Assert-True ([bool]$summary.id) 'Part summary id' 'Created summary returned id'
$summary=Invoke-Api PATCH "/part-summaries/$($summary.id)" @{revision='B'} $script:AdminHeaders 'Update part summary'
Assert-Equal $summary.revision 'B' 'Verify part summary update' 'revision'

# Cutter config requirement CRUD against the dedicated new summary.
$req=Invoke-Api POST '/cutter-config/blade-requirements' @{summary_id=$summary.id;part_type_id=$PartTypeId;required_blade_count=3;enabled=$true} $script:AdminHeaders 'Create blade requirement'
Assert-True ([bool]$req.id) 'Blade requirement id' 'Created requirement returned id'
$req=Invoke-Api PATCH "/cutter-config/blade-requirements/$($req.id)" @{required_blade_count=4} $script:AdminHeaders 'Update blade requirement'
Assert-Equal $req.required_blade_count 4 'Verify blade requirement update' 'required_blade_count'

# Parts + Roll Master
$partNumber=New-Token 'E2E-PART'
$part=Invoke-Api POST '/parts' @{part_number=$partNumber;summary_id=$summary.id;part_type_id=$PartTypeId;teeth=10;active=$true;enabled=$true} $script:AdminHeaders 'Create part'
Assert-True ([bool]$part.id) 'Part id' 'Created part returned id'
$part=Invoke-Api PATCH "/parts/$($part.id)" @{teeth=11} $script:AdminHeaders 'Update part'
Assert-Equal $part.teeth 11 'Verify part update' 'teeth'

$roll=Invoke-Api POST '/roll-masters' @{part_id=$part.id;required_count=2;active=$true;enabled=$true;notes='E2E backend mutation'} $script:AdminHeaders 'Create roll master'
Assert-True ([bool]$roll.id) 'Roll master id' 'Created roll master returned id'
$roll=Invoke-Api PATCH "/roll-masters/$($roll.id)" @{required_count=3;notes='E2E updated'} $script:AdminHeaders 'Update roll master'
Assert-Equal $roll.required_count 3 'Verify roll master update' 'required_count'

# Location CRUD + duplicate unique-value rejection.
$locationSerial=New-Token 'E2E-LOC'
$locationBody=@{serial_number=$locationSerial;number=$locationSerial;description='E2E backend mutation';department='E2E';location_type='INTERNAL';enabled=$true}
$location=Invoke-Api POST '/locations' $locationBody $script:AdminHeaders 'Create location'
$location=Invoke-Api PATCH "/locations/$($location.id)" @{description='E2E backend mutation updated'} $script:AdminHeaders 'Update location'
Assert-Equal $location.description 'E2E backend mutation updated' 'Verify location update' 'description'
Invoke-ExpectFailure POST '/locations' $locationBody $script:AdminHeaders @(409) 'Duplicate location rejected with message'|Out-Null
Invoke-ExpectFailure PATCH '/locations/00000000-0000-4000-8000-000000000001' @{description='missing'} $script:AdminHeaders @(404) 'Missing record mutation rejected with message'|Out-Null
Invoke-ExpectFailure PATCH '/locations/not-a-uuid' @{description='bad uuid'} $script:AdminHeaders @(400) 'Invalid UUID mutation rejected with message'|Out-Null

# Tray + blade + blade-tray CRUD and rollback check.
$tray=Invoke-Api POST '/trays' @{serial_number=(New-AssetSerial 'T');blade_count=0;enabled=$true} $script:AdminHeaders 'Create tray'
$renamedTray=New-AssetSerial 'T'
$tray=Invoke-Api PATCH "/trays/$($tray.id)" @{serial_number=$renamedTray} $script:AdminHeaders 'Update tray'
Assert-Equal $tray.serial_number $renamedTray 'Verify tray update' 'serial_number'

$blade1=Invoke-Api POST '/blades' @{summary_id=$SummaryId;serial_number=(New-Token 'E2E-BLADE');part_type_id=$PartTypeId;status='new';service_cycle=0;enabled=$true} $script:AdminHeaders 'Create blade'
$blade1=Invoke-Api PATCH "/blades/$($blade1.id)" @{service_cycle=1} $script:AdminHeaders 'Update blade'
Assert-Equal $blade1.service_cycle 1 'Verify blade update' 'service_cycle'

$blade2=Invoke-Api POST '/blades' @{summary_id=$SummaryId;serial_number=(New-Token 'E2E-BLADE-MISMATCH');part_type_id=$OppositePartTypeId;status='new';service_cycle=0;enabled=$true} $script:AdminHeaders 'Create mismatch blade'

$bladeTray=Invoke-Api POST '/bladeTrays' @{tray_id=$tray.id;blade_id=$blade1.id;enabled=$true} $script:AdminHeaders 'Create blade-tray assignment'
Invoke-ExpectFailure PATCH "/bladeTrays/$($bladeTray.id)" @{enabled=$true} $script:AdminHeaders @(422) 'Reject generic blade-tray assignment patch'|Out-Null
Invoke-ExpectFailure DELETE "/blades/$($blade1.id)" $null $script:AdminHeaders @(409) 'Reject deletion of assigned blade'|Out-Null
Invoke-ExpectFailure POST '/bladeTrays' @{tray_id=$tray.id;blade_id=$blade2.id;enabled=$true} $script:AdminHeaders @(409) 'Mismatched blade-tray transaction rejected'|Out-Null
$activeAssignments=@(Invoke-Api GET "/bladeTrays/tray/$($tray.id)/active" $null $script:AdminHeaders 'Read blade-tray assignments after rejected transaction')
Assert-Equal $activeAssignments.Count 1 'Rejected blade-tray mutation rolled back' 'active assignment count'
Assert-Equal $activeAssignments[0].blade_id $blade1.id 'Rejected mismatch blade not assigned' 'remaining blade_id'

Invoke-Api DELETE "/bladeTrays/$($bladeTray.id)" $null $script:AdminHeaders 'Delete blade-tray assignment'|Out-Null
Invoke-Api DELETE "/blades/$($blade1.id)" $null $script:AdminHeaders 'Delete first blade'|Out-Null
Invoke-Api DELETE "/blades/$($blade2.id)" $null $script:AdminHeaders 'Delete mismatch blade'|Out-Null
Invoke-Api DELETE "/trays/$($tray.id)" $null $script:AdminHeaders 'Delete tray'|Out-Null

# Batch blade route
$batchTray=Invoke-Api POST '/trays' @{serial_number=(New-AssetSerial 'T');blade_count=0;enabled=$true} $script:AdminHeaders 'Create batch tray'
$batch=Invoke-Api POST '/bladeTrays/batch' @{tray_id=$batchTray.id;summary_id=$SummaryId;part_type_id=$PartTypeId;quantity=2;status='new';service_cycle=0} $script:AdminHeaders 'Create blade batch'
Assert-Equal $batch.quantity 2 'Verify blade batch quantity' 'quantity'
$batchAssignments=@(Invoke-Api GET "/bladeTrays/tray/$($batchTray.id)/active" $null $script:AdminHeaders 'Read batch assignments')
foreach($assignment in $batchAssignments){ Invoke-Api DELETE "/bladeTrays/$($assignment.id)" $null $script:AdminHeaders "Delete batch assignment $($assignment.id)"|Out-Null }
foreach($bladeId in @($batch.blade_ids)){ Invoke-Api DELETE "/blades/$bladeId" $null $script:AdminHeaders "Delete batch blade $bladeId"|Out-Null }
Invoke-Api DELETE "/trays/$($batchTray.id)" $null $script:AdminHeaders 'Delete batch tray'|Out-Null

# Location-tray CRUD with generic INTERNAL location and empty tray.
$moveTray=Invoke-Api POST '/trays' @{serial_number=(New-AssetSerial 'T');blade_count=0;enabled=$true} $script:AdminHeaders 'Create location-move tray'
$moveLocation=Invoke-Api POST '/locations' @{serial_number=(New-Token 'E2E-MOVE-LOC');number='E2E-MOVE';description='E2E move';department='E2E';location_type='INTERNAL';enabled=$true} $script:AdminHeaders 'Create location-move location'
$locationTray=Invoke-Api POST '/locationTrays' @{tray_id=$moveTray.id;location_id=$moveLocation.id;enabled=$true} $script:AdminHeaders 'Create location-tray assignment'
$locationTray=Invoke-Api PATCH "/locationTrays/$($locationTray.id)" @{enabled=$true} $script:AdminHeaders 'Update location-tray assignment'
Invoke-Api DELETE "/locationTrays/$($locationTray.id)" $null $script:AdminHeaders 'Delete location-tray assignment'|Out-Null
Invoke-Api DELETE "/trays/$($moveTray.id)" $null $script:AdminHeaders 'Delete location-move tray'|Out-Null
Invoke-Api DELETE "/locations/$($moveLocation.id)" $null $script:AdminHeaders 'Delete location-move location'|Out-Null

# Container CRUD + failed container-tray business mutation must leave no assignment.
$container=Invoke-Api POST '/containers' @{serial_number=(New-AssetSerial 'C');enabled=$true} $script:AdminHeaders 'Create container'
$container=Invoke-Api PATCH "/containers/$($container.id)" @{enabled=$true} $script:AdminHeaders 'Update container'
$emptyTray=Invoke-Api POST '/trays' @{serial_number=(New-AssetSerial 'T');blade_count=0;enabled=$true} $script:AdminHeaders 'Create empty tray for rejected container load'
Invoke-ExpectFailure POST '/containerTrays' @{tray_id=$emptyTray.id;container_id=$container.id;enabled=$true} $script:AdminHeaders @(422) 'Invalid container load rejected with message'|Out-Null
$current=Invoke-Api GET "/containerTrays/tray/$($emptyTray.id)/current" $null $script:AdminHeaders 'Verify rejected container load state'
Assert-NoRecord $current 'Rejected container load rolled back' 'No active container-tray assignment exists after rejection'
Invoke-Api DELETE "/trays/$($emptyTray.id)" $null $script:AdminHeaders 'Delete rejected-load tray'|Out-Null
Invoke-Api DELETE "/containers/$($container.id)" $null $script:AdminHeaders 'Delete container'|Out-Null

# Generic container-tray PATCH/DELETE routes are intentionally workflow-controlled.
# Exercise both endpoints and verify they reject direct mutation with useful messages.
Invoke-ExpectFailure PATCH "/containerTrays/$DirectContainerTrayId" @{enabled=$false} $script:AdminHeaders @(422) 'Direct container-tray PATCH rejected with message'|Out-Null
Invoke-ExpectFailure DELETE "/containerTrays/$DirectContainerTrayId" $null $script:AdminHeaders @(422) 'Direct container-tray DELETE rejected with message'|Out-Null
$directCt=Invoke-Api GET "/containerTrays/$DirectContainerTrayId" $null $script:AdminHeaders 'Verify rejected direct container-tray mutations'
Assert-True ([bool]$directCt.enabled) 'Direct container-tray rejection preserved state' 'Assignment remains enabled after rejected PATCH/DELETE'

# validate-tray endpoint should return a useful invalid reason, not mutate.
$validateTray=Invoke-Api POST '/trays' @{serial_number=(New-AssetSerial 'T');blade_count=0;enabled=$true} $script:AdminHeaders 'Create validate-tray fixture'
$validation=Invoke-Api POST '/cutter-config/validate-tray' @{summary_id=$SummaryId;part_type_id=$PartTypeId;tray_serial_number=$validateTray.serial_number} $script:AdminHeaders 'Validate incomplete tray'
Assert-True (-not [bool]$validation.valid) 'Incomplete tray validation result' 'Incomplete tray is invalid'
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$validation.reason)) 'Incomplete tray validation reason' "Reason=$($validation.reason)"
Invoke-Api DELETE "/trays/$($validateTray.id)" $null $script:AdminHeaders 'Delete validate-tray fixture'|Out-Null

# Cleanup/disabling for resources without DELETE endpoints.
Invoke-Api PATCH "/roll-masters/$($roll.id)" @{active=$false;enabled=$false} $script:AdminHeaders 'Disable roll master test record'|Out-Null
Invoke-Api PATCH "/parts/$($part.id)" @{active=$false;enabled=$false} $script:AdminHeaders 'Disable part test record'|Out-Null
Invoke-Api DELETE "/cutter-config/blade-requirements/$($req.id)" $null $script:AdminHeaders 'Disable blade requirement test record'|Out-Null
Invoke-Api DELETE "/locations/$($location.id)" $null $script:AdminHeaders 'Delete location test record'|Out-Null
Invoke-Api DELETE "/part-summaries/$($summary.id)" $null $script:AdminHeaders 'Delete part summary test record'|Out-Null

Write-Host ''
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host ' AUTHENTICATED BACKEND MUTATION TEST SUMMARY' -ForegroundColor Cyan
Write-Host '=================================================================' -ForegroundColor Cyan
$Results|Format-Table -AutoSize
$failed=@($Results|Where-Object Status -eq 'FAIL').Count
if($failed -gt 0){ exit 1 }
Write-Host '[PASS] AUTHENTICATED BACKEND MUTATION SUITE PASSED.' -ForegroundColor Green
exit 0
