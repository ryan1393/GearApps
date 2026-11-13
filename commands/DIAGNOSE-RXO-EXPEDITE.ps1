[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ContainerName = 'truck-log-rxo-expedite-scheduler'

function Invoke-ReadOnlyDocker {
    param([string[]]$CommandArguments, [string]$InputText)
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = 1
        if ($PSBoundParameters.ContainsKey('InputText')) {
            $lines = @($InputText | & $DockerExe @CommandArguments 2>$null)
        } else { $lines = @(& $DockerExe @CommandArguments 2>$null) }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    return [pscustomobject]@{ Success = ($code -eq 0); Text = ($lines -join "`n") }
}
function Safe-DiagnosticDate($Value) {
    if ($Value -isnot [string] -or $Value.Length -gt 64) { return $null }
    $date = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse($Value, [ref]$date)) { return $date.ToUniversalTime().ToString('o') }
    return $null
}

try {
    $DockerExe = (Get-Command docker -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $context = Invoke-ReadOnlyDocker -CommandArguments @('context', 'show')
    $contextName = if ($context.Success -and $context.Text.Trim() -match '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$') { $context.Text.Trim() } else { 'UNKNOWN' }
    $report = [ordered]@{ observedAt = [DateTimeOffset]::UtcNow.ToString('o'); dockerContext = $contextName; container = $ContainerName; containerState = $null; worker = $null; note = $null }
    # Read only State, internally. Never print Error, Health.Log, Config.Env or logs.
    $inspection = Invoke-ReadOnlyDocker -CommandArguments @('inspect', '--format', '{{json .State}}', $ContainerName)
    if (-not $inspection.Success) { throw 'Could not inspect the Expedite scheduler on the current Docker connection. No containers or state files were changed.' }
    $state = ConvertFrom-Json -InputObject $inspection.Text
    $status = if ($state.Status -in @('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead')) { $state.Status } else { 'UNKNOWN' }
    $health = 'NOT_CONFIGURED'
    if ($state.PSObject.Properties['Health'] -and $state.Health -and $state.Health.PSObject.Properties['Status']) {
        if ($state.Health.Status -in @('healthy', 'unhealthy', 'starting')) { $health = $state.Health.Status }
    }
    $restartObservation = Invoke-ReadOnlyDocker -CommandArguments @('inspect', '--format', '{{.RestartCount}}', $ContainerName)
    $restartCount = if ($restartObservation.Success -and $restartObservation.Text.Trim() -match '^\d{1,9}$') { [int]$restartObservation.Text.Trim() } else { $null }
    $report.containerState = [ordered]@{ restartCount = $restartCount; status = $status; running = ($state.Running -eq $true); restarting = ($state.Restarting -eq $true); paused = ($state.Paused -eq $true); oomKilled = ($state.OOMKilled -eq $true); exitCode = [int]$state.ExitCode; health = $health; startedAt = (Safe-DiagnosticDate $state.StartedAt); finishedAt = (Safe-DiagnosticDate $state.FinishedAt) }
    if ($state.Running -eq $true) {
        # Fixed public program on stdin avoids Windows PowerShell legacy quoting.
        # The six named JSON files are the only files this program reads.
        $program = @'
import fs from 'node:fs';
const root='/app/data/', now=Date.now();
function read(name) {
  try {const p=root+name,s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)return {status:'INVALID',value:null};return {status:'READ',value:JSON.parse(fs.readFileSync(p,'utf8'))};}
  catch(e){return {status:e?.code==='ENOENT'?'MISSING':'UNREADABLE',value:null};}
}
const date=v=>typeof v==='string'&&v.length<=64&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const knownCodes=new Set([
  "ACQUISITION_LOCK_REVIEW","ACQUISITION_PATH_REVIEW","ALREADY_QUEUED","ARGUMENTS_REVIEW","AUTHENTICATED",
  "AUTHENTICATION_FAILED","AUTH_CONTROL_REVIEW","BATCH_ID_REVIEW","BEFORE_SUBMIT","BOUNDARY_REVIEW",
  "BROWSER_CLOSED","BROWSER_EXECUTABLE_MISSING","BROWSER_LAUNCH","BROWSER_RUNTIME_MISSING","CONFIG_REVIEW",
  "CREDENTIALS_MISSING","CREDENTIALS_UNCHANGED","CREDENTIAL_INPUT_REVIEW","CREDENTIAL_STORAGE_REVIEW","CREDENTIAL_UPDATE_BUSY",
  "CRITICAL_VALUE_REVIEW","DISK_FULL","DOWNLOAD_FAILED","DOWNLOAD_SAVE","DUPLICATE_SHIPMENT_ID",
  "EAI_AGAIN","ETA_VALUE_REVIEW","EXPEDITE_ACQUISITION_BUSY","EXPEDITE_ACQUISITION_FAILED","EXPEDITE_BROWSER_CLOSE_TIMEOUT",
  "EXPEDITE_BROWSER_LAUNCH_TIMEOUT","EXPEDITE_CREDENTIALS_NOT_CONFIGURED","EXPEDITE_EXPORT_TIMEOUT","EXPEDITE_NOT_RUN","EXPEDITE_OPERATION_FAILED",
  "EXPEDITE_PASSWORD_REQUIRED","EXPEDITE_SCHEDULED_EXPORT_FAILED","EXPEDITE_USERNAME_REQUIRED","EXPORT_CONTROL","EXPORT_CONTROL_REVIEW",
  "EXPORT_DOWNLOAD","EXPORT_DOWNLOAD_FAILED","EXPORT_NOT_XLSX","FIELD_TYPE_REVIEW","FILESYSTEM_ERROR",
  "FREIGHT_LIST_CONTROL_REVIEW","FREIGHT_LIST_DATA_REVIEW","FREIGHT_ON_THE_MOVE","HEALTH_REVIEW","INTERACTIVE_LOGIN_REQUIRED",
  "INTERRUPTED_ACQUISITION","LATEST_SHIPMENTS_REVIEW","LIST_CONTROL","LIST_DATA","NETWORK_ERROR",
  "NOT_IMPLEMENTED","NOT_REQUIRED","NOT_RUN","NOT_STARTED","NO_AUTH_HOLD",
  "PERMISSION_DENIED","PROFILE_BUSY","RECIPIENT_REVIEW","RETRY_LIMIT","RXO_AUTH_ACCESS_REVIEW",
  "RXO_AUTH_ACCOUNT_REVIEW","RXO_AUTH_APP_NOT_READY","RXO_AUTH_CREDENTIALS_CHANGED","RXO_AUTH_FORM_AMBIGUOUS","RXO_AUTH_FORM_NOT_READY",
  "RXO_AUTH_INPUT_NOT_RETAINED","RXO_AUTH_NAVIGATION_REVIEW","RXO_AUTH_ORIGIN_REVIEW","RXO_AUTH_PASSWORD_STEP_NOT_READY","RXO_AUTH_REJECTED",
  "RXO_AUTH_SESSION_REVIEW","RXO_AUTH_STATE_REVIEW","RXO_AUTH_SUBMISSION_UNCONFIRMED","RXO_AUTH_VERIFICATION_REQUIRED","RXO_EXPEDITE",
  "SCHEDULER_STATUS_REVIEW","SCHEMA_DRIFT_REVIEW","SCHEMA_DUPLICATE_HEADER_REVIEW","SCHEMA_EXTRA_CELL_REVIEW","SCHEMA_HEADERS_REVIEW",
  "SCHEMA_SHIPMENT_ID_REQUIRED","SETTINGS_REVIEW","SHIPMENT_ID_REQUIRED","SHIPMENT_ID_REVIEW","SMTP_CLOSED",
  "SMTP_GREETING","SMTP_NOT_ACCEPTED","SMTP_PROTOCOL","SMTP_RESPONSE_LIMIT","SMTP_TIMEOUT",
  "STATE_REVIEW","VALIDATION_FAILED","WORKBOOK_VALIDATION","XLSX_ACTIVE_CONTENT_REVIEW","XLSX_CELL_REVIEW",
  "XLSX_CELL_TYPE_REVIEW","XLSX_CRC_REVIEW","XLSX_DATE_SYSTEM_REVIEW","XLSX_ENCODING_REVIEW","XLSX_EXTERNAL_LINK_REVIEW",
  "XLSX_HIDDEN_ROW_REVIEW","XLSX_PATH_REVIEW","XLSX_ROW_REVIEW","XLSX_SCHEMA_REVIEW","XLSX_SHEET_REVIEW",
  "XLSX_SIZE_REVIEW","XLSX_UNSUPPORTED_CONTENT_REVIEW","XLSX_XML_REVIEW","XLSX_ZIP_REVIEW","ZERO_ROW_REGRESSION_REVIEW"
]);
const code=v=>typeof v==='string'&&knownCodes.has(v)?v:null;
const pick=(v,values)=>values.includes(v)?v:null;
const stages=['PREPARATION','BROWSER_LAUNCH','AUTHENTICATION','LIST_CONTROL','LIST_DATA','EXPORT_CONTROL','EXPORT_DOWNLOAD','DOWNLOAD_SAVE','WORKBOOK_VALIDATION','PUBLICATION'];
const causes=['TIMEOUT','PROFILE_BUSY','BROWSER_CLOSED','BROWSER_EXECUTABLE_MISSING','NETWORK_ERROR','DISK_FULL','PERMISSION_DENIED','FILESYSTEM_ERROR','DOWNLOAD_FAILED','VALIDATION_FAILED','AUTHENTICATION_FAILED','UNEXPECTED'];
const diag=v=>v&&stages.includes(v.stage)&&causes.includes(v.cause)?{stage:v.stage,cause:v.cause}:null;
const scheduler=read('expedite-scheduler-status.json'), s=scheduler.value;
const heartbeat=date(s?.schedulerHeartbeatAt),deadline=date(s?.schedulerLoopDeadlineAt);
const age=heartbeat?now-Date.parse(heartbeat):null;
const health=read('expedite-health.json'), h=health.value;
const hold=read('rxo-auth-review.json'), a=hold.value;
const last=read('rxo-auth-last.json'), l=last.value;
const recovery=read('rxo-connection-recovery.json'), r=recovery.value;
const retry=read('rxo-auth-retry.json'), q=retry.value;
const attempts=Array.isArray(r?.attempts)?r.attempts.map(date).filter(v=>v&&now-Date.parse(v)>=-60000&&now-Date.parse(v)<3600000):[];
const held=hold.status==='MISSING'?false:hold.status==='READ'&&a?.role==='expedite'&&['BEFORE_SUBMIT','FAILED'].includes(a?.phase)?true:null;
const release=process.env.TRUCK_LOG_RELEASE;
console.log(JSON.stringify({observedAt:new Date(now).toISOString(),nodeVersion:process.version,workerRelease:typeof release==='string'&&/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(release)&&release.length<=64?release:null,
 scheduler:{fileStatus:scheduler.status,state:pick(s?.schedulerState,['NOT_STARTED','STARTING','WAITING','EXPORTING','STOPPING','STOPPED']),heartbeatAt:heartbeat,heartbeatAgeSeconds:age===null?null:Math.round(age/1000),loopDeadlineAt:deadline,live:age!==null&&age>=-5000&&age<30000&&!!deadline&&Date.parse(deadline)>now,nextRunAt:date(s?.nextRunAt),currentStartedAt:date(s?.currentStartedAt),lastCompletedAt:date(s?.lastCompletedAt),lastSuccessAt:date(s?.lastSuccessAt),lastFailureAt:date(s?.lastFailureAt),lastErrorCode:code(s?.lastErrorCode)},
 acquisition:{fileStatus:health.status,state:pick(h?.state,['RUNNING','SUCCESS','REVIEW','FAILED']),startedAt:date(h?.startedAt),completedAt:date(h?.completedAt),errorCode:code(h?.errorCode),diagnostic:diag(h?.diagnostic)},
 authentication:{holdFileStatus:hold.status,held,code:code(a?.code),phase:pick(a?.phase,['BEFORE_SUBMIT','FAILED']),updatedAt:date(a?.updatedAt),passwordSubmissions:[0,1].includes(a?.passwordSubmissions)?a.passwordSubmissions:null,lastFileStatus:last.status,lastCode:code(l?.code),lastUpdatedAt:date(l?.updatedAt)},
 recovery:{fileStatus:recovery.status,phase:pick(r?.phase,['QUEUED','RUNNING','AUTHENTICATED','FAILED']),requestedAt:date(r?.requestedAt),updatedAt:date(r?.updatedAt),attemptsInLastHour:attempts.length,limit:3,retryWindowEndsAt:attempts.length?new Date(Math.min(...attempts.map(Date.parse))+3600000).toISOString():null,retryFileStatus:retry.status,retryRequestedAt:date(q?.requestedAt)}
}));
'@
        $observed = Invoke-ReadOnlyDocker -CommandArguments @('exec', '-i', $ContainerName, 'node', '--input-type=module') -InputText $program
        if ($observed.Success) {
            try { $report.worker = ConvertFrom-Json -InputObject $observed.Text }
            catch { $report.note = 'Worker diagnostic output was invalid. Raw output has not been displayed.' }
        } else { $report.note = 'Could not read the allowed worker state files. No restart, recovery request or state change was attempted.' }
    } else { $report.note = 'The container is not running, so Docker exec cannot read its state files. It was not started or restarted.' }
    Write-Output ($report | ConvertTo-Json -Depth 8)
} catch {
    Write-Output '{"diagnosticError":"Docker or diagnostic data was unavailable. No raw errors, logs, credentials or state mutations were exposed."}'
    exit 1
}
