param(
    [string]$BaseUrl = "http://localhost:3333/api/v1",
    [string]$ServerRoot = "http://localhost:3333",
    [string]$Email = "test@gearapps.local",
    [string]$Password,
    [string]$AdminEmail = "admin@gearapps.local",
    [string]$AdminPassword = "GearApps-Admin-Only-2026!",

    # Full workflow test inputs. If omitted, the runner prompts for them.
    [string]$TraySerialNumber,
    [string]$SummaryId,
    [string]$PartTypeId,
    [string]$ContainerSerialNumber,
    [string]$CutterBodySerialNumber,
    [string]$MachineNumber,
    [string]$PartNumber,
    [string]$WrongTypePartNumber,
    [string]$WrongTypeMachineNumber,
    [string]$ChangeoverReasonCode = 'CHANGEOVER',
    [string]$PullReasonCode,
    [string]$TeardownTraySerialNumber,

    [int]$GrindingScrapCount = 0,
    [int]$StartingPieceCount = 0,
    [int]$QualityPieceCount = 50,
    [int]$FinalPieceCount = 100,
    [ValidateSet('FC','CMM')] [string]$QualityCheckType = 'FC',
    [ValidateSet('PASS','FAIL','HOLD')] [string]$QualityResult = 'PASS',
    [int]$TeardownScrapCount = 0,

    # Normal mode executes the full workflow using dedicated E2E data.
    # Use -PreflightOnly only for a deliberate non-mutating diagnostic run.
    [switch]$PreflightOnly,
    [switch]$SkipBuild,
    [switch]$SkipSmoke,
    [switch]$SkipCutterBodyTransition,
    [switch]$SkipBackendMutations,
    [switch]$SkipWorkflow,
    [switch]$ShowResponses,
    [switch]$KeepStartedServer,
    [switch]$HarnessOnly,
    [switch]$NoAutoTestData
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$RouteManifestPath = (Resolve-Path (Join-Path $PSScriptRoot 'api-route-manifest.json')).Path
$StartedServer = $false
$ServerProcess = $null
$Results = @()

function Add-MasterResult {
    param([string]$Test,[string]$Status,[string]$Detail='')
    $script:Results += [pscustomobject]@{ Test=$Test; Status=$Status; Detail=$Detail }
    $color = if ($Status -eq 'PASS') {'Green'} elseif ($Status -eq 'SKIP') {'Yellow'} else {'Red'}
    Write-Host ("[{0}] {1} {2}" -f $Status,$Test,$Detail) -ForegroundColor $color
}

function Require-Value {
    param([string]$Current,[string]$Prompt)
    if ($Current) { return $Current }
    return (Read-Host $Prompt).Trim()
}

function Invoke-ChildTest {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [Parameter(Mandatory=$true)][string]$ScriptPath,
        [hashtable]$Parameters = @{}
    )

    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        Add-MasterResult $Name 'FAIL' "Script not found: $ScriptPath"
        throw "$Name script not found: $ScriptPath"
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $Name" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    # Hashtable splatting preserves named PowerShell parameters.
    # Array splatting of '-Name', value pairs is intentionally not used.
    try {
        $global:LASTEXITCODE = 0
        & $ScriptPath @Parameters
        $childExitCode = $LASTEXITCODE
    } catch {
        Add-MasterResult $Name 'FAIL' $_.Exception.Message
        throw
    }

    if ($childExitCode -ne 0) {
        Add-MasterResult $Name 'FAIL' "Exit code $childExitCode"
        throw "$Name failed with exit code $childExitCode."
    }

    Add-MasterResult $Name 'PASS'
}

function Assert-TestHarness {
    Write-Host ""
    Write-Host "---- TEST HARNESS SELF-CHECK ----" -ForegroundColor Cyan

    $requiredFiles = @(
        $RouteManifestPath,
        (Join-Path $PSScriptRoot 'validate-gear-apps.ps1'),
        (Join-Path $PSScriptRoot 'test-all-api-routes.ps1'),
        (Join-Path $PSScriptRoot 'smoke-test-api.ps1'),
        (Join-Path $PSScriptRoot 'test-shelf-location-conventions.ps1'),
        (Join-Path $PSScriptRoot 'test-cutter-body-dana-assignment.ps1'),
        (Join-Path $PSScriptRoot 'data-import\test-data-import-contract.mjs'),
        (Join-Path $PSScriptRoot 'data-import\test-legacy-log-dedupe.mjs'),
        (Join-Path $PSScriptRoot 'test-authenticated-backend-mutations.ps1'),
        (Join-Path $PSScriptRoot 'test-data\ensure-backend-mutation-test-fixtures.mjs'),
        (Join-Path $PSScriptRoot 'test-data\cleanup-backend-mutation-direct-fixtures.mjs'),
        (Join-Path $PSScriptRoot 'test-concurrent-backend-mutation.mjs'),
        (Join-Path $PSScriptRoot 'test-authenticated-mutation-coverage-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-backend-mutation-fixture-schema-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-backend-mutation-null-response-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-post-workflow-db-integrity.mjs'),
        (Join-Path $PSScriptRoot 'test-post-workflow-db-integrity-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-full-workflow.ps1'),
        (Join-Path $PSScriptRoot 'test-cutter-builder-request-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-ui-consistency-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-sidebar-navigation-hierarchy-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-diamond-brand-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-toast-notifications-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-shared-icon-assets-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-component-consolidation-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-kpi-balance-icon-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-ui-release-hardening-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-external-dana-ui-package-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-ui-ownership-adoption-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-master-ui-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-shared-export-integrity-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-summary-card-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-frontend-docker-health-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-dana-apps-premerge-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-global-professional-ui-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-ui-style-integrity-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-ui-foundation-cleanup-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-inventory-control-center-search-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-shared-table-migration-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-workflow-surface-consolidation-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-ui-deep-scan-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-angular-template-structure-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-location-identity-display-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-tray-contents-part-type-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-parent-child-drilldown-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-shop-floor-readability-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-large-screen-readability-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-inventory-lookup-ui-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-blade-inventory-control-center-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-native-asset-tag-printing-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-blade-locations-management-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-greenshed-part-shelf-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-cuttergrind-part-shelf-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-empty-tray-availability-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-summary-shelf-dash-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-blade-dashboard-live-data-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-no-raw-debug-ui-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-login-swagger-ui-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-local-debug-login-startup-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-public-registration-closed-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-scrap-blade-history-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-login-ui-consistency-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-shared-ui-style-source-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-admin-management-ui-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-admin-backend-consistency-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-department-app-access-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-greenshed-available-cutters-contract.mjs'),
        (Join-Path $PSScriptRoot 'data-import\test-full-data-reset-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-data\ensure-workflow-test-fixtures.mjs'),
        (Join-Path $PSScriptRoot 'test-data\ensure-automatic-test-user.mjs'),
        (Join-Path $PSScriptRoot 'test-data\test-fixture-enum-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-data\test-start-grinding-db-contract.mjs'),
        (Join-Path $PSScriptRoot 'test-data\test-blade-status-fixture-contract.mjs')
    )

    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Required test file not found: $file"
        }
    }

    $manifest = Get-Content -LiteralPath $RouteManifestPath -Raw | ConvertFrom-Json
    $manifestRoutes = if ($null -ne $manifest.routes) { @($manifest.routes) } else { @($manifest) }
    if ($manifestRoutes.Count -ne 113) {
        throw "Route manifest must contain 113 routes; found $($manifestRoutes.Count)."
    }

    $contracts = @(
        @{
            Path = (Join-Path $PSScriptRoot 'test-all-api-routes.ps1')
            Parameters = @('ServerRoot','Email','Password','ManifestPath')
        },
        @{
            Path = (Join-Path $PSScriptRoot 'smoke-test-api.ps1')
            Parameters = @('BaseUrl','Email','Password','ShowResponses')
        },
        @{
            Path = (Join-Path $PSScriptRoot 'test-shelf-location-conventions.ps1')
            Parameters = @('BaseUrl','Email','Password','SummaryNumber')
        },
        @{
            Path = (Join-Path $PSScriptRoot 'test-cutter-body-dana-assignment.ps1')
            Parameters = @('BaseUrl','Email','Password','Execute','ShowResponses')
        },
        @{
            Path = (Join-Path $PSScriptRoot 'test-authenticated-backend-mutations.ps1')
            Parameters = @(
                'BaseUrl','AdminEmail','AdminPassword','UserEmail','UserPassword',
                'SummaryId','PartTypeId','OppositePartTypeId','RunToken',
                'DirectContainerTrayId','DirectContainerId','DirectTrayId',
                'TargetUserId','ShowResponses'
            )
        },
        @{
            Path = (Join-Path $PSScriptRoot 'test-full-workflow.ps1')
            Parameters = @(
                'BaseUrl','Email','Password','TraySerialNumber','SummaryId',
                'PartTypeId','ContainerSerialNumber','CutterBodySerialNumber',
                'MachineNumber','PartNumber','WrongTypePartNumber','WrongTypeMachineNumber','ChangeoverReasonCode','PullReasonCode',
                'TeardownTraySerialNumber','GrindingScrapCount','StartingPieceCount',
                'QualityPieceCount','FinalPieceCount','QualityCheckType','QualityResult',
                'TeardownScrapCount','Execute','ShowResponses'
            )
        }
    )

    foreach ($contract in $contracts) {
        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            $contract.Path,
            [ref]$tokens,
            [ref]$parseErrors
        )

        if ($parseErrors.Count -gt 0) {
            $messages = ($parseErrors | ForEach-Object { $_.Message }) -join '; '
            throw "PowerShell parse error in '$($contract.Path)': $messages"
        }

        if ($null -eq $ast.ParamBlock) {
            throw "Test harness mismatch: '$($contract.Path)' has no param block."
        }

        $declaredParameters = @(
            $ast.ParamBlock.Parameters |
                ForEach-Object { $_.Name.VariablePath.UserPath }
        )

        foreach ($parameterName in $contract.Parameters) {
            if ($declaredParameters -notcontains $parameterName) {
                throw "Test harness mismatch: '$($contract.Path)' does not expose parameter '$parameterName'."
            }
        }
    }

    Write-Host "[PASS] Test scripts, PowerShell syntax, parameter contracts, and 113-route manifest are valid." -ForegroundColor Green
}

function Test-ApiReady {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$ServerRoot/api/v1/health" -TimeoutSec 3
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Start-GearAppsApi {
    if (Test-ApiReady) {
        Add-MasterResult 'API startup' 'PASS' 'Existing API server is reachable.'
        return
    }

    Write-Host "Starting Gear Apps API in a separate PowerShell process..." -ForegroundColor Yellow
    $escapedRoot = $ProjectRoot.Replace("'", "''")
    $command = "Set-Location '$escapedRoot'; `$env:NX_DAEMON='false'; `$env:NX_ISOLATE_PLUGINS='false'; npx nx serve gear-app-server"
    $script:ServerProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',$command) -PassThru
    $script:StartedServer = $true

    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-ApiReady) {
            Add-MasterResult 'API startup' 'PASS' "Started server process PID $($script:ServerProcess.Id)."
            return
        }
        if ($script:ServerProcess.HasExited) {
            throw "API server process exited before becoming ready. Exit code: $($script:ServerProcess.ExitCode)"
        }
    }
    throw 'Timed out waiting 90 seconds for the Gear Apps API to become ready.'
}

function Ensure-WorkflowTestFixtures {
    param(
        [string]$RequestedSummaryId,
        [string]$RequestedPartTypeId
    )

    $fixtureScript = Join-Path $PSScriptRoot 'test-data\ensure-workflow-test-fixtures.mjs'
    if (-not (Test-Path -LiteralPath $fixtureScript -PathType Leaf)) {
        throw "Workflow test fixture script not found: $fixtureScript"
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " Workflow test data provisioning" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "No usable test tray was supplied. Creating/reusing dedicated E2E test fixtures." -ForegroundColor Yellow

    $nodeArgs = @($fixtureScript)
    if ($RequestedSummaryId -and $RequestedPartTypeId) {
        $nodeArgs += @('--summaryId', $RequestedSummaryId, '--partTypeId', $RequestedPartTypeId)
    }

    $raw = & node @nodeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Workflow test fixture provisioning failed with exit code $LASTEXITCODE."
    }

    try {
        $fixture = ($raw | Out-String).Trim() | ConvertFrom-Json
    } catch {
        throw "Workflow test fixture script did not return valid JSON. Output: $raw"
    }

    if (-not $fixture.ok) {
        throw 'Workflow test fixture provisioning did not report success.'
    }

    Write-Host "[PASS] Source tray:   $($fixture.source_tray_serial_number)" -ForegroundColor Green
    Write-Host "[PASS] Teardown tray: $($fixture.teardown_tray_serial_number)" -ForegroundColor Green
    Write-Host "[PASS] Summary:       $($fixture.summary_number)" -ForegroundColor Green
    Write-Host "[PASS] Part type:     $($fixture.part_type_code)" -ForegroundColor Green
    Write-Host "[PASS] Blade count:   $($fixture.required_blade_count)" -ForegroundColor Green
    Write-Host "[PASS] Shelves:       $($fixture.shelves.greenshed) / $($fixture.shelves.dull) / $($fixture.shelves.finished)" -ForegroundColor Green

    return $fixture
}

function Resolve-SummaryNumber {
    param([string]$Id)
    $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/email/login" -ContentType 'application/json' -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
    if (-not $login.accessToken) { throw 'Authentication did not return an access token while resolving the summary number.' }
    $headers = @{ Authorization = "Bearer $($login.accessToken)" }
    $summary = Invoke-RestMethod -Method Get -Uri "$BaseUrl/part-summaries/$([uri]::EscapeDataString($Id))" -Headers $headers
    if (-not $summary.number) { throw "Summary '$Id' did not return a summary number." }
    return ([string]$summary.number).Trim().ToUpper()
}

function Resolve-PartTypeCodeFromPart {
    param([string]$Number)
    $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/email/login" -ContentType 'application/json' -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
    if (-not $login.accessToken) { throw 'Authentication did not return an access token while resolving the workflow Part Type.' }
    $headers = @{ Authorization = "Bearer $($login.accessToken)" }
    $part = Invoke-RestMethod -Method Get -Uri "$BaseUrl/parts/number/$([uri]::EscapeDataString($Number))" -Headers $headers
    $code = ([string]$part.part_type.code).Trim().ToUpper()
    if ($code -notin @('RING','PINION')) { throw "Part '$Number' did not resolve to RING or PINION." }
    return $code
}


try {
    Set-Location $ProjectRoot
    $env:NX_DAEMON = 'false'
    $env:NX_ISOLATE_PLUGINS = 'false'

    Write-Host "" 
    Write-Host "################################################################" -ForegroundColor Cyan
    Write-Host " Gear Apps - ONE FILE / ALL TESTS" -ForegroundColor Cyan
    Write-Host "################################################################" -ForegroundColor Cyan
    Write-Host "Project: $ProjectRoot"
    if ($PreflightOnly) {
        Write-Host "Diagnostic mode: workflow is PRE-FLIGHT ONLY." -ForegroundColor Yellow
    } else {
        Write-Host "Automatic mode: full workflow executes against dedicated E2E test data." -ForegroundColor Green
    }

    Assert-TestHarness

    if ($HarnessOnly) {
        Add-MasterResult 'Test harness self-check' 'PASS' 'Scripts, named parameters, and 113-route manifest validated.'
        Write-Host ''
        Write-Host '[PASS] TEST HARNESS SELF-CHECK PASSED.' -ForegroundColor Green
        exit 0
    }

    if (-not $Password) {
        $Password = 'GearApps-E2E-Only-2026!'
    }

    if (-not $SkipBuild) {
        Invoke-ChildTest 'Build validation' "$PSScriptRoot\validate-gear-apps.ps1"
    } else {
        Add-MasterResult 'Build validation' 'SKIP' '-SkipBuild supplied.'
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " Fresh data-import contract test" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    & node "$PSScriptRoot\data-import\test-data-import-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Fresh data-import contract test' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Fresh data-import contract test failed.'
    }
    Add-MasterResult 'Fresh data-import contract test' 'PASS'

    & node "$PSScriptRoot\data-import\test-legacy-log-dedupe.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Legacy duplicate-log reconciliation test' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Legacy duplicate-log reconciliation test failed.'
    }
    Add-MasterResult 'Legacy duplicate-log reconciliation test' 'PASS'

    & node "$PSScriptRoot\data-import\test-legacy-null-mf-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Legacy null-MF startup contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Legacy null-MF startup contract failed.'
    }
    Add-MasterResult 'Legacy null-MF startup contract' 'PASS'

    & node "$PSScriptRoot\test-data\test-workflow-harness-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Workflow harness regression contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Workflow harness regression contract failed.'
    }
    Add-MasterResult 'Workflow harness regression contract' 'PASS'

    & node "$PSScriptRoot\test-data\test-fixture-enum-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Fixture enum contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Fixture enum contract failed.'
    }
    Add-MasterResult 'Fixture enum contract' 'PASS'

    & node "$PSScriptRoot\test-nx-install-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Nx clean-install/startup contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Nx clean-install/startup contract failed.'
    }
    Add-MasterResult 'Nx clean-install/startup contract' 'PASS'

    & node "$PSScriptRoot\test-db-lock-query-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Database lock/relation contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Database lock/relation contract failed.'
    }
    Add-MasterResult 'Database lock/relation contract' 'PASS'

    & node "$PSScriptRoot\test-fk-relation-sync-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'FK/relation synchronization contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'FK/relation synchronization contract failed.'
    }
    Add-MasterResult 'FK/relation synchronization contract' 'PASS'

    & node "$PSScriptRoot\test-error-message-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Explicit error-message contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Explicit error-message contract failed.'
    }
    Add-MasterResult 'Explicit error-message contract' 'PASS'

    & node "$PSScriptRoot\test-cutter-builder-request-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Cutter Builder request contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Cutter Builder request contract failed.'
    }
    Add-MasterResult 'Cutter Builder request contract' 'PASS' 'Workflow, frontend, and backend DTO use cutter_body_identifier.'

    & node "$PSScriptRoot\test-ui-consistency-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'UI consistency contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'UI consistency contract failed.'
    }
    Add-MasterResult 'UI consistency contract' 'PASS' 'Blade Tracking, Cutter Builder, and Greenshed share the same app shell/dashboard design language.'

    & node "$PSScriptRoot\test-sidebar-navigation-hierarchy-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Sidebar navigation hierarchy contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Sidebar navigation hierarchy contract failed.'
    }
    Add-MasterResult 'Sidebar navigation hierarchy contract' 'PASS' 'Brand carries app identity and each app exposes one combined dashboard row without a redundant WORKSPACE/app row.'

    & node "$PSScriptRoot\test-dana-diamond-brand-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Diamond brand contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Diamond brand contract failed.'
    }
    Add-MasterResult 'Dana Diamond brand contract' 'PASS' 'Blade Tracking, Cutter Builder, and Greenshed use the Dana Diamond instead of the GA placeholder.'

    & node "$PSScriptRoot\test-toast-notifications-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana/Gear toast compatibility contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana/Gear toast compatibility contract failed.'
    }
    Add-MasterResult 'Dana/Gear toast compatibility contract' 'PASS' 'Shared Dana toast owns behavior while Gear compatibility aliases and transaction wiring remain intact.'

    & node "$PSScriptRoot\test-shared-icon-assets-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Shared semantic icon contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Shared semantic icon contract failed.'
    }
    Add-MasterResult 'Shared semantic icon contract' 'PASS' 'Central SVG workflow icons are used by navigation, KPIs, and shared operation cards without Unicode fallback glyphs.'

    & node "$PSScriptRoot\test-dana-component-consolidation-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana component consolidation contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana component consolidation contract failed.'
    }
    Add-MasterResult 'Dana component consolidation contract' 'PASS' 'Shared page headers and dashboard operation cards remain component-owned across Gear Apps.'

    & node "$PSScriptRoot\test-dana-kpi-balance-icon-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana KPI/icon balance contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana KPI/icon balance contract failed.'
    }
    Add-MasterResult 'Dana KPI/icon balance contract' 'PASS' 'KPI geometry and operation-card icon/tone coverage remain stable across all three apps.'

    & node "$PSScriptRoot\test-dana-summary-card-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana summary card contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana summary card contract failed.'
    }
    Add-MasterResult 'Dana summary card contract' 'PASS' 'Inventory Control Center and Blade Locations share the maintained summary-card primitive.'

    & node "$PSScriptRoot\test-dana-ui-release-hardening-contract.mjs"
    & node "$PSScriptRoot\test-dana-ui-ownership-adoption-contract.mjs"
    & node "$PSScriptRoot\test-dana-master-ui-contract.mjs"
    & node "$PSScriptRoot\test-dana-shared-export-integrity-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana UI release hardening contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana UI release hardening contract failed.'
    }
    Add-MasterResult 'Dana UI release hardening contract' 'PASS' 'Shared component, KPI, loading, page-header, and no-inline-style release protections are enforced.'

    & node "$PSScriptRoot\test-external-dana-ui-package-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'External Dana UI package contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'External Dana UI package contract failed.'
    }
    Add-MasterResult 'External Dana UI package contract' 'PASS' 'Gear Apps consumes vendored @dana/ui 0.2.0 from the Truck Log visual baseline while retaining temporary local compatibility/domain layers.'

    & node "$PSScriptRoot\audit-dana-ui-migration-test-surface.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana UI migration test-surface audit' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana UI migration test-surface audit failed.'
    }
    Add-MasterResult 'Dana UI migration test-surface audit' 'PASS' 'Current Gear test contracts were scanned for migration-sensitive markup/style/package assumptions.'

    & node "$PSScriptRoot\test-frontend-docker-health-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Gear frontend Docker health contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Gear frontend Docker health contract failed.'
    }
    Add-MasterResult 'Gear frontend Docker health contract' 'PASS' 'All three Nginx frontends use explicit IPv4 health probes against maintained /healthz endpoints.'

    & node "$PSScriptRoot\test-dana-apps-premerge-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Apps pre-merge hardening contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Apps pre-merge hardening contract failed.'
    }
    Add-MasterResult 'Dana Apps pre-merge hardening contract' 'PASS' 'Frontend security, physical project paths, Compose hardening, shared app boundaries, and clean Dana Apps naming are enforced.'
    & node "$PSScriptRoot\test-dana-apps-fresh-docker-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Apps fresh Docker host contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Apps fresh Docker host contract failed.'
    }
    Add-MasterResult 'Dana Apps fresh Docker host contract' 'PASS' 'Fresh Docker hosts create the Gear volume, initialize an empty schema once, seed login/reference data, import base data, and keep runtime synchronize disabled.'
    & node --test "$PSScriptRoot\base-data\bootstrap-policy.test.mjs" "$PSScriptRoot\set-version.test.mjs" "$PSScriptRoot\test-deployment-config.cjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Deployment configuration behavior' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Deployment configuration behavior failed.'
    }
    Add-MasterResult 'Deployment configuration behavior' 'PASS' 'Automatic imports preserve master data; URL/Sentry settings and release versions are validated.'

    & node "$PSScriptRoot\test-dana-apps-fresh-db-runtime-deps-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Apps fresh DB runtime dependencies contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Apps fresh DB runtime dependencies contract failed.'
    }
    Add-MasterResult 'Dana Apps fresh DB runtime dependencies contract' 'PASS' 'Production seed/bootstrap path does not import dev-only falso and the Docker bootstrap bundle is audited during build.'



    & node "$PSScriptRoot\test-global-professional-ui-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Global professional UI contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Global professional UI contract failed.'
    }
    Add-MasterResult 'Global professional UI contract' 'PASS' 'All three apps share the central enterprise shell/dashboard styling and Blade Tracking exposes the Inventory Control Center in its sidebar.'

    & node "$PSScriptRoot\test-ui-style-integrity-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'UI style integrity contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'UI style integrity contract failed.'
    }
    Add-MasterResult 'UI style integrity contract' 'PASS' 'The public entry point remains import-only, modules stay under the line ceiling, and same-context duplicate selector debt is zero.'

    & node "$PSScriptRoot\test-ui-foundation-cleanup-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'UI foundation cleanup contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'UI foundation cleanup contract failed.'
    }
    Add-MasterResult 'UI foundation cleanup contract' 'PASS' 'One canonical token source, shared table ownership, retired dead CSS, and semantic search/sort controls are enforced.'

    & node "$PSScriptRoot\test-inventory-control-center-search-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Inventory Control Center search contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Inventory Control Center search contract failed.'
    }
    Add-MasterResult 'Inventory Control Center search contract' 'PASS' 'All four inventory tabs provide full-database search while preserving pagination and relationship drilldowns.'

    & node "$PSScriptRoot\test-shared-table-migration-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Shared table migration contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Shared table migration contract failed.'
    }
    Add-MasterResult 'Shared table migration contract' 'PASS' 'All maintained frontend tables use the shared table system and parent/detail rows remain grouped during sort/filter operations.'

    & node "$PSScriptRoot\test-workflow-surface-consolidation-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Workflow surface consolidation contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Workflow surface consolidation contract failed.'
    }
    Add-MasterResult 'Workflow surface consolidation contract' 'PASS' 'Cutter Builder and Greenshed workflow pages use shared sections, fields, actions, and result surfaces.'

    & node "$PSScriptRoot\test-ui-deep-scan-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'UI deep-scan contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'UI deep-scan contract failed.'
    }
    Add-MasterResult 'UI deep-scan contract' 'PASS' 'Page shells, routes, handlers, forms, and search wiring are consistent.'

    & node "$PSScriptRoot\test-angular-template-structure-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Angular template structure contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Angular template structure contract failed.'
    }
    Add-MasterResult 'Angular template structure contract' 'PASS' 'Angular production templates have balanced element tags before Nx compilation.'


    & node "$PSScriptRoot\test-location-identity-display-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Location identity display contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Location identity display contract failed.'
    }
    Add-MasterResult 'Location identity display contract' 'PASS' 'Operator-facing physical placements use the scannable location serial/tag rather than locations.number.'


    & node "$PSScriptRoot\test-tray-contents-part-type-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Tray Contents Part Type contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Tray Contents Part Type contract failed.'
    }
    Add-MasterResult 'Tray Contents Part Type contract' 'PASS' 'Tray Contents and key tray-facing views expose Summary + Part Type together.'


    & node (Join-Path $PSScriptRoot 'test-parent-child-drilldown-contract.mjs')
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Parent/child drilldown contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Parent/child drilldown contract failed.'
    }
    Add-MasterResult 'Parent/child drilldown contract' 'PASS' 'Parent inventory records expose their real child relationships without raw JSON.'

    & node (Join-Path $PSScriptRoot 'test-shop-floor-readability-contract.mjs')
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Shop-floor readability contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Shop-floor readability contract failed.'
    }
    Add-MasterResult 'Shop-floor readability contract' 'PASS' 'Body typography and parent/child rows meet the shop-floor readability baseline.'

    & node (Join-Path $PSScriptRoot 'test-large-screen-readability-contract.mjs')
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Large-screen readability contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Large-screen readability contract failed.'
    }
    Add-MasterResult 'Large-screen readability contract' 'PASS' '1500px+ displays receive the larger body/table/control scale without changing the desktop shell.'

    & node "$PSScriptRoot\test-ux-responsive-navigation-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'UX responsive navigation contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'UX responsive navigation contract failed.'
    }
    Add-MasterResult 'UX responsive navigation contract' 'PASS' 'Narrow-screen topbar remains available and the shared sidebar becomes a working off-canvas drawer.'
    & node "$PSScriptRoot\test-dana-responsive-data-surface-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana responsive data surface contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana responsive data surface contract failed.'
    }
    Add-MasterResult 'Dana responsive data surface contract' 'PASS' 'Shared table shells own horizontal overflow/touch behavior and mobile data tables preserve readable minimum width.'
    & node "$PSScriptRoot\test-dana-responsive-page-layout-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana responsive page layout contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana responsive page layout contract failed.'
    }
    Add-MasterResult 'Dana responsive page layout contract' 'PASS' 'Page headers, action toolbars, detail grids, responsive grid, and stack primitives share one mobile layout policy.'
    & node "$PSScriptRoot\test-dana-master-ui-freeze-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana master UI freeze contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana master UI freeze contract failed.'
    }
    Add-MasterResult 'Dana master UI freeze contract' 'PASS' 'Dana shared/domain ownership and responsive shell/data/page policies are locked as the Dana Apps master UI baseline.'
    & node "$PSScriptRoot\test-dana-apps-gear-premerge-readiness-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Apps Gear pre-merge readiness contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Apps Gear pre-merge readiness contract failed.'
    }
    Add-MasterResult 'Dana Apps Gear pre-merge readiness contract' 'PASS' 'Gear runtime apps/backend, Dana master UI ownership, style layering, and the authoritative Gear regression entry point are ready for the future Truck Log merge.'
    & node "$PSScriptRoot\test-dana-apps-source-package-hygiene-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Apps source package hygiene contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Apps source package hygiene contract failed.'
    }
    Add-MasterResult 'Dana Apps source package hygiene contract' 'PASS' 'Source packaging stages and audits files before ZIP creation and excludes caches, backups, secrets, auth/browser state, and machine-local data.'
    & node "$PSScriptRoot\test-dana-apps-source-package-completeness-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Apps source package completeness contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Apps source package completeness contract failed.'
    }
    Add-MasterResult 'Dana Apps source package completeness contract' 'PASS' 'Root-only package exclusions and staged source-inventory comparison protect legitimate nested source directories such as Cutter Builder pages/build.'

    & node "$PSScriptRoot\test-dana-apps-gear-merge-manifest-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Dana Apps Gear merge manifest contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Dana Apps Gear merge manifest contract failed.'
    }
    Add-MasterResult 'Dana Apps Gear merge manifest contract' 'PASS' 'Live Gear Nx project identities, roots/tags/targets, framework versions, root hashes, Compose files, and protected runtime projects match the pre-merge manifest.'
    & node "$PSScriptRoot\test-dana-apps-gear-handoff-package-contract.mjs"
    if ($LASTEXITCODE -ne 0) { Add-MasterResult 'Dana Apps Gear handoff package contract' 'FAIL' "Exit code $LASTEXITCODE"; throw 'Dana Apps Gear handoff package contract failed.' }
    Add-MasterResult 'Dana Apps Gear handoff package contract' 'PASS' 'One-click Gear handoff packaging refreshes/validates the live manifest, validates source hygiene, uses the maintained staged packager, and emits SHA-256 metadata.'








    & node "$PSScriptRoot\test-ux-workflow-state-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'UX workflow-state contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'UX workflow-state contract failed.'
    }
    Add-MasterResult 'UX workflow-state contract' 'PASS' 'Upstream rescans clear/revalidate downstream state and repeat workflows reset safely.'

    & node "$PSScriptRoot\test-ux-accessibility-feedback-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'UX accessibility/feedback contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'UX accessibility/feedback contract failed.'
    }
    Add-MasterResult 'UX accessibility/feedback contract' 'PASS' 'Scan labels/autofocus, focus-visible styling, live feedback, and submit locking are enforced.'

    & node "$PSScriptRoot\test-inventory-lookup-ui-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Inventory Lookup UI contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Inventory Lookup UI contract failed.'
    }
    Add-MasterResult 'Inventory Lookup UI contract' 'PASS' 'Tray/container/location scans render operator-friendly cards instead of raw JSON.'

    & node "$PSScriptRoot\test-blade-inventory-control-center-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Blade Tracking Inventory Control Center contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Blade Tracking Inventory Control Center contract failed.'
    }
    Add-MasterResult 'Blade Tracking Inventory Control Center contract' 'PASS' 'Trays, containers, locations, and blades are paginated, relationship-aware, drillable, and operator-readable.'

    & node "$PSScriptRoot\test-native-asset-tag-printing-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Native asset-tag printing contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Native asset-tag printing contract failed.'
    }
    Add-MasterResult 'Native asset-tag printing contract' 'PASS' 'Database-backed tray/container/location serials produce native IPL Code 128 tags with authenticated printing and PRN fallback.'

    & node "$PSScriptRoot\test-blade-locations-management-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Blade/Admin Locations contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Blade/Admin Locations contract failed.'
    }
    Add-MasterResult 'Blade/Admin Locations contract' 'PASS' 'Blade Tracking locations expose trays and blades; Admin manages location master data with occupied-location safety.'

    & node "$PSScriptRoot\test-greenshed-part-shelf-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Green Shed part-specific shelf contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Green Shed part-specific shelf contract failed.'
    }
    Add-MasterResult 'Green Shed part-specific shelf contract' 'PASS' 'RING uses GSR-<summary>, PINION uses GSP-<summary>, and all Summary shelf tags use a prefix-summary dash.'

    & node "$PSScriptRoot\test-cuttergrind-part-shelf-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Cuttergrind part-specific shelf contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Cuttergrind part-specific shelf contract failed.'
    }
    Add-MasterResult 'Cuttergrind part-specific shelf contract' 'PASS' 'RING uses CGDR-/CGFR-, PINION uses CGDP-/CGFP-, and workflow validation uses Summary + Part Type.'

    & node "$PSScriptRoot\test-empty-tray-availability-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Empty tray availability contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Empty tray availability contract failed.'
    }
    Add-MasterResult 'Empty tray availability contract' 'PASS' 'EMPTY/0-blade trays require no location; teardown only requires the part-specific dull shelf when blades are returned.'

    & node "$PSScriptRoot\test-summary-shelf-dash-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Summary shelf dash contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Summary shelf dash contract failed.'
    }
    Add-MasterResult 'Summary shelf dash contract' 'PASS' 'GSR-/GSP-/CGDR-/CGDP-/CGFR-/CGFP- are canonical; generic CGD-/CGF- and undashed tags are migration-only.'

    & node "$PSScriptRoot\test-blade-dashboard-live-data-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Blade Tracking live dashboard contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Blade Tracking live dashboard contract failed.'
    }
    Add-MasterResult 'Blade Tracking live dashboard contract' 'PASS' 'Blade dashboard KPI counts, workflow summaries, coater inventory, and recent activity are database-backed.'

    & node "$PSScriptRoot\test-no-raw-debug-ui-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'No raw/debug frontend UI contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'No raw/debug frontend UI contract failed.'
    }
    Add-MasterResult 'No raw/debug frontend UI contract' 'PASS' 'All Angular frontend source is free of raw JSON dumps, debug PRE blocks, JSON.stringify rendering, whole-object interpolation, and console debug output.'

    & node "$PSScriptRoot\test-public-registration-closed-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Public registration closed contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Public registration closed contract failed.'
    }
    Add-MasterResult 'Public registration closed contract' 'PASS' 'Public self-registration is absent; Admin-only POST /users remains the account-creation path.'

    & node "$PSScriptRoot\test-scrap-blade-history-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Scrap / Discarded Blades contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Scrap / Discarded Blades contract failed.'
    }
    Add-MasterResult 'Scrap / Discarded Blades contract' 'PASS' 'SCRAPPED blades are searchable and expose operator-readable lifecycle history without adding an API route.'

    & node "$PSScriptRoot\test-login-swagger-ui-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Login/Swagger UI runtime contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Login/Swagger UI runtime contract failed.'
    }
    Add-MasterResult 'Login/Swagger UI runtime contract' 'PASS' 'Swagger base URL and local UI login behavior are aligned.'

    & node "$PSScriptRoot\test-local-debug-login-startup-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Local debug login/startup contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Local debug login/startup contract failed.'
    }
    Add-MasterResult 'Local debug login/startup contract' 'PASS' 'Localhost-only shortcuts fill email only, ship no frontend passwords, and Nx reset lock recovery remains hardened.'

    & node "$PSScriptRoot\test-login-ui-consistency-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Login UI consistency contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Login UI consistency contract failed.'
    }
    Add-MasterResult 'Login UI consistency contract' 'PASS' 'All three apps use one full-screen Gear Apps login experience.'

    & node "$PSScriptRoot\test-shared-ui-style-source-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Modular UI styling contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Modular UI styling contract failed.'
    }
    Add-MasterResult 'Modular UI styling contract' 'PASS' 'Every Angular frontend consumes one Gear Apps entry point backed by ordered design-system modules and the shared Tailwind factory.'

    & node "$PSScriptRoot\test-admin-management-ui-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Admin management UI/API contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Admin management UI/API contract failed.'
    }
    Add-MasterResult 'Admin management UI/API contract' 'PASS' 'Admin create screens and protected master-data endpoints are present.'

    & node "$PSScriptRoot\test-admin-backend-consistency-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Admin backend consistency contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Admin backend consistency contract failed.'
    }
    Add-MasterResult 'Admin backend consistency contract' 'PASS' 'Shared AdminApiService, audit/error rules, and ADMIN-only Cutter Body mutations are enforced.'

    & node "$PSScriptRoot\test-department-app-access-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Department app-access contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Department app-access contract failed.'
    }
    Add-MasterResult 'Department app-access contract' 'PASS' 'Cross-department dashboard view and department-scoped operational edits are enforced.'

    & node "$PSScriptRoot\test-greenshed-available-cutters-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Green Shed available-cutters contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Green Shed available-cutters contract failed.'
    }
    Add-MasterResult 'Green Shed available-cutters contract' 'PASS' 'Dashboard lists all open READY/SHELF cutter builds from the database, even when shelf location is absent.'

    & node "$PSScriptRoot\data-import\test-full-data-reset-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Full data reset contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Full data reset contract failed.'
    }
    Add-MasterResult 'Full data reset contract' 'PASS' 'Fresh source is validated before destructive PostgreSQL reset and clean re-import.'

    & node "$PSScriptRoot\test-authenticated-mutation-coverage-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Authenticated mutation coverage contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Authenticated mutation coverage contract failed.'
    }
    Add-MasterResult 'Authenticated mutation coverage contract' 'PASS' 'All write routes are classified across backend CRUD, cutter-body transition, workflow, public auth, or authenticated printer output.'

    & node "$PSScriptRoot\test-backend-mutation-fixture-schema-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Backend mutation fixture schema contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Backend mutation fixture schema contract failed.'
    }
    Add-MasterResult 'Backend mutation fixture schema contract' 'PASS' 'Raw SQL fixture table names match TypeORM entity tables.'

    & node "$PSScriptRoot\test-backend-mutation-null-response-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Backend mutation null-response contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Backend mutation null-response contract failed.'
    }
    Add-MasterResult 'Backend mutation null-response contract' 'PASS' 'No-record API responses are normalized safely in rollback assertions.'

    & node "$PSScriptRoot\test-post-workflow-db-integrity-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Post-workflow DB integrity contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Post-workflow DB integrity contract failed.'
    }
    Add-MasterResult 'Post-workflow DB integrity contract' 'PASS' 'Read-only E2E database invariants are present.'

    & node "$PSScriptRoot\test-data\test-blade-status-fixture-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Blade-status fixture contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Blade-status fixture contract failed.'
    }
    Add-MasterResult 'Blade-status fixture contract' 'PASS'

    & node "$PSScriptRoot\test-data\test-part-machine-compatibility-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'PINION/RING compatibility contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'PINION/RING compatibility contract failed.'
    }
    Add-MasterResult 'PINION/RING compatibility contract' 'PASS' 'Part-number and machine-type gates are present and exercised.'

    & node "$PSScriptRoot\test-data\ensure-automatic-test-user.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Automatic test-user provisioning' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Automatic test-user provisioning failed.'
    }
    Add-MasterResult 'Automatic test-user provisioning' 'PASS' 'No login prompt required.'

    & node "$PSScriptRoot\test-read-only-api-smoke-source-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Read-only API smoke source contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Read-only API smoke source contract failed.'
    }
    Add-MasterResult 'Read-only API smoke source contract' 'PASS' 'Container/location scan probes select enabled source records before calling enabled-only scan endpoints.'

    Start-GearAppsApi

    Invoke-ChildTest '113-route runtime probe' "$PSScriptRoot\test-all-api-routes.ps1" @{
        ServerRoot = $ServerRoot
        Email      = $Email
        Password     = $Password
        ManifestPath = $RouteManifestPath
    }

    if (-not $SkipSmoke) {
        $smokeParams = @{
            BaseUrl  = $BaseUrl
            Email    = $Email
            Password = $Password
        }
        if ($ShowResponses) { $smokeParams.ShowResponses = $true }
        Invoke-ChildTest 'Read-only API smoke test' "$PSScriptRoot\smoke-test-api.ps1" $smokeParams
    } else {
        Add-MasterResult 'Read-only API smoke test' 'SKIP' '-SkipSmoke supplied.'
    }

    if (-not $SkipBackendMutations -and -not $PreflightOnly) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host " Authenticated backend mutation fixture provisioning" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan

        $backendFixtureRaw = & node "$PSScriptRoot\test-data\ensure-backend-mutation-test-fixtures.mjs"
        if ($LASTEXITCODE -ne 0) {
            Add-MasterResult 'Backend mutation fixture provisioning' 'FAIL' "Exit code $LASTEXITCODE"
            throw 'Backend mutation fixture provisioning failed.'
        }
        try {
            $backendFixture = ($backendFixtureRaw | Out-String).Trim() | ConvertFrom-Json
        } catch {
            throw "Backend mutation fixture script did not return valid JSON. Output: $backendFixtureRaw"
        }
        if (-not $backendFixture.ok) {
            throw 'Backend mutation fixture provisioning did not report success.'
        }
        Add-MasterResult 'Backend mutation fixture provisioning' 'PASS' "Run $($backendFixture.run_token)"

        $backendParams = @{
            BaseUrl               = $BaseUrl
            AdminEmail            = [string]$backendFixture.admin_email
            AdminPassword         = [string]$backendFixture.admin_password
            UserEmail             = [string]$backendFixture.user_email
            UserPassword          = [string]$backendFixture.user_password
            SummaryId             = [string]$backendFixture.summary_id
            PartTypeId            = [string]$backendFixture.part_type_id
            OppositePartTypeId    = [string]$backendFixture.opposite_part_type_id
            RunToken              = [string]$backendFixture.run_token
            DirectContainerTrayId = [string]$backendFixture.direct_container_tray_id
            DirectContainerId     = [string]$backendFixture.direct_container_id
            DirectTrayId          = [string]$backendFixture.direct_tray_id
            TargetUserId          = [string]$backendFixture.target_user_id
        }
        if ($ShowResponses) { $backendParams.ShowResponses = $true }

        try {
            Invoke-ChildTest 'Authenticated backend mutation suite' "$PSScriptRoot\test-authenticated-backend-mutations.ps1" $backendParams

            $oldBackendBase = $env:GEAR_APPS_BASE_URL
            $oldBackendAdminEmail = $env:GEAR_APPS_E2E_ADMIN_EMAIL
            $oldBackendAdminPassword = $env:GEAR_APPS_E2E_ADMIN_PASSWORD
            try {
                $env:GEAR_APPS_BASE_URL = $BaseUrl
                $env:GEAR_APPS_E2E_ADMIN_EMAIL = [string]$backendFixture.admin_email
                $env:GEAR_APPS_E2E_ADMIN_PASSWORD = [string]$backendFixture.admin_password
                & node "$PSScriptRoot\test-concurrent-backend-mutation.mjs"
                if ($LASTEXITCODE -ne 0) {
                    Add-MasterResult 'Concurrent duplicate mutation test' 'FAIL' "Exit code $LASTEXITCODE"
                    throw 'Concurrent duplicate mutation test failed.'
                }
                Add-MasterResult 'Concurrent duplicate mutation test' 'PASS' 'One duplicate create committed; the other returned 409 with a message.'
            } finally {
                $env:GEAR_APPS_BASE_URL = $oldBackendBase
                $env:GEAR_APPS_E2E_ADMIN_EMAIL = $oldBackendAdminEmail
                $env:GEAR_APPS_E2E_ADMIN_PASSWORD = $oldBackendAdminPassword
            }
        } finally {
            & node "$PSScriptRoot\test-data\cleanup-backend-mutation-direct-fixtures.mjs" `
                "--containerTrayId=$($backendFixture.direct_container_tray_id)" `
                "--containerId=$($backendFixture.direct_container_id)" `
                "--trayId=$($backendFixture.direct_tray_id)"
            if ($LASTEXITCODE -eq 0) {
                Add-MasterResult 'Backend mutation direct-fixture cleanup' 'PASS'
            } else {
                Add-MasterResult 'Backend mutation direct-fixture cleanup' 'FAIL' "Exit code $LASTEXITCODE"
            }
        }
    } else {
        $reason = if ($PreflightOnly) { '-PreflightOnly supplied.' } else { '-SkipBackendMutations supplied.' }
        Add-MasterResult 'Authenticated backend mutation suite' 'SKIP' $reason
        Add-MasterResult 'Concurrent duplicate mutation test' 'SKIP' $reason
    }

    if (-not $SkipCutterBodyTransition) {
        $transitionEmail = if ($backendFixture -and $backendFixture.admin_email) {
            [string]$backendFixture.admin_email
        } else {
            $AdminEmail
        }
        $transitionPassword = if ($backendFixture -and $backendFixture.admin_password) {
            [string]$backendFixture.admin_password
        } else {
            $AdminPassword
        }

        $transitionParams = @{
            BaseUrl  = $BaseUrl
            Email    = $transitionEmail
            Password = $transitionPassword
        }
        if (-not $PreflightOnly) { $transitionParams.Execute = $true }
        if ($ShowResponses) { $transitionParams.ShowResponses = $true }

        $transitionName = if (-not $PreflightOnly) {
            'Cutter-body MF -> Dana MUTATING test'
        } else {
            'Cutter-body MF -> Dana PRE-FLIGHT test'
        }
        Invoke-ChildTest $transitionName "$PSScriptRoot\test-cutter-body-dana-assignment.ps1" $transitionParams
    } else {
        Add-MasterResult 'Cutter-body MF -> Dana test' 'SKIP' '-SkipCutterBodyTransition supplied.'
    }

    if (-not $SkipWorkflow) {
        if (-not $NoAutoTestData) {
            $fixture = Ensure-WorkflowTestFixtures $SummaryId $PartTypeId

            # The automatic workflow crosses Blade Tracking, Cutter Builder,
            # and Greenshed. A normal user is intentionally department-scoped,
            # so the end-to-end cross-app workflow runs with the dedicated
            # admin test account while department authorization is tested
            # separately with non-admin fixture users.
            $Email = $AdminEmail
            $Password = $AdminPassword
            $SummaryId = [string]$fixture.summary_id
            $PartTypeId = [string]$fixture.part_type_id
            $TraySerialNumber = [string]$fixture.source_tray_serial_number
            $TeardownTraySerialNumber = [string]$fixture.teardown_tray_serial_number
            $ContainerSerialNumber = [string]$fixture.blade_tracking.container_serial_number
            $CutterBodySerialNumber = [string]$fixture.cutter_body_serial_number
            $MachineNumber = [string]$fixture.machine_number
            $PartNumber = [string]$fixture.part_number
            $WrongTypePartNumber = [string]$fixture.wrong_type_part_number
            $WrongTypeMachineNumber = [string]$fixture.wrong_type_machine_number
            $ChangeoverReasonCode = [string]$fixture.changeover_reason_code
            $PullReasonCode = [string]$fixture.teardown_reason_code
            Add-MasterResult 'Workflow test fixture provisioning' 'PASS' "AUTO: summary $($fixture.summary_number); source $TraySerialNumber; cutter $CutterBodySerialNumber; machine $MachineNumber; part $PartNumber"


    & node "$PSScriptRoot\test-data\test-start-grinding-db-contract.mjs"
    if ($LASTEXITCODE -ne 0) {
        Add-MasterResult 'Start-grinding DB contract' 'FAIL' "Exit code $LASTEXITCODE"
        throw 'Start-grinding DB contract failed.'
    }
    Add-MasterResult 'Start-grinding DB contract' 'PASS' 'Transaction was rolled back.'
        } else {
            foreach ($required in @(
                @{Value=$TraySerialNumber;Name='Source tray serial number'},
                @{Value=$SummaryId;Name='Summary ID'},
                @{Value=$PartTypeId;Name='Part type ID'},
                @{Value=$TeardownTraySerialNumber;Name='Empty teardown tray serial number'},
                @{Value=$ContainerSerialNumber;Name='Coater container serial number'},
                @{Value=$CutterBodySerialNumber;Name='Cutter body serial number'},
                @{Value=$MachineNumber;Name='Green Shed machine number'},
                @{Value=$PartNumber;Name='Part number'},
                @{Value=$WrongTypePartNumber;Name='Wrong-type part number'},
                @{Value=$WrongTypeMachineNumber;Name='Wrong-type machine number'},
                @{Value=$PullReasonCode;Name='Teardown-required pull reason code'}
            )) {
                if (-not $required.Value) {
                    throw "$($required.Name) is required when -NoAutoTestData is supplied."
                }
            }
        }

        $summaryNumber = Resolve-SummaryNumber $SummaryId
        $workflowPartTypeCode = Resolve-PartTypeCodeFromPart $PartNumber
        $greenshedPrefix = if ($workflowPartTypeCode -eq 'RING') { 'GSR' } else { 'GSP' }
        Write-Host "Resolved Summary ID $SummaryId -> Summary $summaryNumber / $workflowPartTypeCode" -ForegroundColor Cyan
        Write-Host "Expected shelves: $greenshedPrefix-$summaryNumber / $(if ($workflowPartTypeCode -eq 'RING') { 'CGDR' } else { 'CGDP' })-$summaryNumber / $(if ($workflowPartTypeCode -eq 'RING') { 'CGFR' } else { 'CGFP' })-$summaryNumber" -ForegroundColor Cyan

        Invoke-ChildTest 'Shelf-location convention test' "$PSScriptRoot\test-shelf-location-conventions.ps1" @{
            BaseUrl       = $BaseUrl
            Email         = $Email
            Password      = $Password
            SummaryNumber = $summaryNumber
            PartTypeCode  = $workflowPartTypeCode
        }

        $wfParams = @{
            BaseUrl                  = $BaseUrl
            Email                    = $Email
            Password                 = $Password
            TraySerialNumber         = $TraySerialNumber
            SummaryId                = $SummaryId
            PartTypeId               = $PartTypeId
            ContainerSerialNumber    = $ContainerSerialNumber
            CutterBodySerialNumber   = $CutterBodySerialNumber
            MachineNumber            = $MachineNumber
            PartNumber               = $PartNumber
            WrongTypePartNumber      = $WrongTypePartNumber
            WrongTypeMachineNumber   = $WrongTypeMachineNumber
            ChangeoverReasonCode     = $ChangeoverReasonCode
            PullReasonCode           = $PullReasonCode
            TeardownTraySerialNumber = $TeardownTraySerialNumber
            GrindingScrapCount       = $GrindingScrapCount
            StartingPieceCount       = $StartingPieceCount
            QualityPieceCount        = $QualityPieceCount
            FinalPieceCount          = $FinalPieceCount
            QualityCheckType         = $QualityCheckType
            QualityResult            = $QualityResult
            TeardownScrapCount       = $TeardownScrapCount
        }
        if (-not $PreflightOnly) { $wfParams.Execute = $true }
        if ($ShowResponses) { $wfParams.ShowResponses = $true }

        $workflowName = if (-not $PreflightOnly) {'Full workflow AUTOMATIC E2E test'} else {'Full workflow PRE-FLIGHT test'}
        Invoke-ChildTest $workflowName "$PSScriptRoot\test-full-workflow.ps1" $wfParams

        if (-not $PreflightOnly) {
            & node "$PSScriptRoot\test-post-workflow-db-integrity.mjs"
            if ($LASTEXITCODE -ne 0) {
                Add-MasterResult 'Post-workflow DB integrity/reconciliation' 'FAIL' "Exit code $LASTEXITCODE"
                throw 'Post-workflow DB integrity/reconciliation failed.'
            }
            Add-MasterResult 'Post-workflow DB integrity/reconciliation' 'PASS' 'Read-only E2E database invariants reconciled successfully.'
        } else {
            Add-MasterResult 'Post-workflow DB integrity/reconciliation' 'SKIP' '-PreflightOnly supplied.'
        }
    } else {
        Add-MasterResult 'Shelf-location convention test' 'SKIP' '-SkipWorkflow supplied.'
        Add-MasterResult 'Full workflow test' 'SKIP' '-SkipWorkflow supplied.'
    }

    Write-Host ""
    Write-Host "################################################################" -ForegroundColor Cyan
    Write-Host " MASTER TEST SUMMARY" -ForegroundColor Cyan
    Write-Host "################################################################" -ForegroundColor Cyan
    $Results | Format-Table -AutoSize
    $failed = @($Results | Where-Object Status -eq 'FAIL').Count
    if ($failed -gt 0) {
        Write-Host "[FAIL] $failed master test stage(s) failed." -ForegroundColor Red
        exit 1
    }
    Write-Host '[PASS] ALL REQUESTED GEAR APPS TEST STAGES PASSED.' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "" 
    Write-Host "[FAIL] MASTER TEST RUN STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    if ($Results.Count -gt 0) { $Results | Format-Table -AutoSize }
    exit 1
}
finally {
    if ($StartedServer -and $ServerProcess -and -not $KeepStartedServer) {
        try {
            if (-not $ServerProcess.HasExited) {
                Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue
                Write-Host "Stopped API server process PID $($ServerProcess.Id)." -ForegroundColor DarkGray
            }
        } catch {}
    }
}


