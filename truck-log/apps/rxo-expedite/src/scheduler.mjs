import { readAuthHold, consumeAuthRetry, hasPendingAuthRetry, consumeCredentialChangeRetry, ensureAuthFailureNotification, RxoAuthError } from './lib/rxo-auth.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { acquireOnce, browserCloseTimedOut, MAX_ACQUISITION_MS } from './lib/acquisition.mjs';
import { withTimeout } from './lib/process-lock.mjs';
import { ExpediteError } from './lib/workbook.mjs';
const DATA_ROOT='/app/data';
const STATUS=path.join(DATA_ROOT,'expedite-scheduler-status.json');
const SETTINGS_PATH=path.join(DATA_ROOT,'expedite-control-settings.json');
// Liveness is loop progress: the loop records when it last advanced and the latest time
// by which it must advance again; the compose healthcheck fails once that deadline
// passes even though the heartbeat timer keeps schedulerHeartbeatAt fresh.
const LOOP_IDLE_BOUND_MS=120000,LOOP_MARGIN_MS=180000,AUTH_NOTIFICATION_TIMEOUT_MS=60000;
const boundedInterval=v=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>1440)throw new Error('RXO_EXPEDITE_SYNC_INTERVAL_MINUTES must be an integer from 1 to 1440.');return n;};
function readSettings(){
 const defaults={intervalMinutes:boundedInterval(process.env.RXO_EXPEDITE_SYNC_INTERVAL_MINUTES??30),syncOnStart:String(process.env.RXO_EXPEDITE_SYNC_ON_START??'true').toLowerCase()!=='false'};
 if(!fs.existsSync(SETTINGS_PATH))return defaults;
 try{const st=fs.lstatSync(SETTINGS_PATH);if(!st.isFile()||st.isSymbolicLink()||st.size>8192)return defaults;const v=JSON.parse(fs.readFileSync(SETTINGS_PATH,'utf8'));return {intervalMinutes:boundedInterval(v.intervalMinutes??defaults.intervalMinutes),syncOnStart:typeof v.syncOnStart==='boolean'?v.syncOnStart:defaults.syncOnStart};}catch{return defaults;}
}
const initialSettings=readSettings();
let stopping=false,running=false,heartbeat=null,state={contractVersion:1,source:'RXO_EXPEDITE',version:process.env.TRUCK_LOG_RELEASE||'1.0.4',schedulerState:'STARTING',intervalMinutes:initialSettings.intervalMinutes,syncOnStart:initialSettings.syncOnStart,schedulerStartedAt:new Date().toISOString(),schedulerHeartbeatAt:new Date().toISOString(),schedulerLoopAt:new Date().toISOString(),schedulerLoopDeadlineAt:new Date(Date.now()+LOOP_IDLE_BOUND_MS).toISOString(),currentStartedAt:null,nextRunAt:null,lastCompletedAt:null,lastSuccessAt:null,lastFailureAt:null,lastErrorCode:null,lastDurationSeconds:null,lastSourceBatchId:null};
function write(){state.schedulerHeartbeatAt=new Date().toISOString();const temp=STATUS+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.renameSync(temp,STATUS);}
function markLoop(boundMs=LOOP_IDLE_BOUND_MS){const now=Date.now();state.schedulerLoopAt=new Date(now).toISOString();state.schedulerLoopDeadlineAt=new Date(now+boundMs).toISOString();}
function errorCode(e){return (e instanceof ExpediteError||e instanceof RxoAuthError)&&typeof e.code==='string'?e.code:'EXPEDITE_SCHEDULED_EXPORT_FAILED';}
function sleep(ms){return new Promise(resolve=>{const until=Date.now()+ms;const tick=()=>{if(stopping)return resolve();const left=until-Date.now();if(left<=0)return resolve();setTimeout(tick,Math.min(1000,left));};tick();});}
// Auth state files are validated strictly; a malformed one throws RXO_AUTH_STATE_REVIEW.
// It must never escape the loop (the restart policy would crash-loop): report it as a
// paused state and keep the scheduler alive until the file is repaired or removed.
let authStateError=null;
function authCall(operation,fallback){
 try{const value=operation();if(authStateError){console.log('[RXO EXPEDITE] Sign-in state is readable again.');if(state.lastErrorCode===authStateError)state.lastErrorCode=null;authStateError=null;}return {value,error:null};}
 catch(e){const code=e instanceof RxoAuthError?e.code:'RXO_AUTH_STATE_REVIEW';
  if(authStateError!==code)console.error('[RXO EXPEDITE] '+code+': sign-in state could not be read; automatic scans are paused until it is repaired.');
  authStateError=code;state.schedulerState='WAITING';state.lastErrorCode=code;state.nextRunAt=null;write();return {value:fallback,error:code};}
}
async function notifyAuthFailure(){try{await withTimeout(ensureAuthFailureNotification(DATA_ROOT,'expedite'),AUTH_NOTIFICATION_TIMEOUT_MS,'SMTP_TIMEOUT');}catch{}}
async function runOne(){
 if(stopping)return;markLoop();
 const retry=authCall(()=>consumeAuthRetry(DATA_ROOT,'expedite'),false);
 const pending=authCall(()=>hasPendingAuthRetry(DATA_ROOT,'expedite'),true);
 if(retry.error||pending.error||pending.value)return;
 const changed=authCall(()=>consumeCredentialChangeRetry(DATA_ROOT,'expedite'),false);
 const held=authCall(()=>readAuthHold(DATA_ROOT,'expedite'),null);
 if(changed.error||held.error)return;
 if(held.value){await notifyAuthFailure();state.schedulerState='WAITING';state.lastErrorCode=held.value.code;state.nextRunAt=null;write();return;}
 if(changed.value)state.lastErrorCode=null;
 running=true;const started=Date.now();state.schedulerState='EXPORTING';state.currentStartedAt=new Date(started).toISOString();state.nextRunAt=null;state.lastErrorCode=null;
 // acquireOnce bounds browser launch, the export flow and browser close.
 markLoop(MAX_ACQUISITION_MS+LOOP_MARGIN_MS);write();
 try{const result=await acquireOnce({chromium,protectZeroRegression:true});state.lastSuccessAt=new Date().toISOString();state.lastSourceBatchId=result?.sourceBatchId??null;state.lastErrorCode=null;}
 catch(e){state.lastFailureAt=new Date().toISOString();state.lastErrorCode=errorCode(e);}
 finally{state.lastCompletedAt=new Date().toISOString();state.lastDurationSeconds=Math.round((Date.now()-started)/100)/10;state.currentStartedAt=null;running=false;markLoop();}
 if(browserCloseTimedOut()){
  // A wedged Chromium would keep the profile locked for every later run: exit so the
  // restart policy (init: true reaps children) starts the scheduler with a clean process tree.
  console.error('[RXO EXPEDITE] Restarting the scheduler to release a Chromium process that did not close.');
  stopping=true;state.schedulerState='STOPPING';state.nextRunAt=null;try{write();}catch{}process.exitCode=75;
 }
}
async function waitForNext(baseMs){
 while(!stopping){
  markLoop();
  const retry=authCall(()=>consumeAuthRetry(DATA_ROOT,'expedite'),false);if(retry.value)return;
  const pending=authCall(()=>hasPendingAuthRetry(DATA_ROOT,'expedite'),true);
  if(pending.error||pending.value){await sleep(1000);continue;}
  const changed=authCall(()=>consumeCredentialChangeRetry(DATA_ROOT,'expedite'),false);if(changed.value)return;
  const held=authCall(()=>readAuthHold(DATA_ROOT,'expedite'),null);
  if(retry.error||changed.error||held.error){await sleep(5000);continue;}
  if(held.value){await notifyAuthFailure();state.schedulerState='WAITING';state.lastErrorCode=held.value.code;state.nextRunAt=null;write();await sleep(1000);continue;}
  const settings=readSettings();state.intervalMinutes=settings.intervalMinutes;state.syncOnStart=settings.syncOnStart;
  const due=baseMs+settings.intervalMinutes*60000;state.schedulerState='WAITING';state.nextRunAt=new Date(due).toISOString();write();
  const left=due-Date.now();if(left<=0)return;await sleep(Math.min(1000,left));
 }
}
async function main(){fs.mkdirSync(DATA_ROOT,{recursive:true});heartbeat=setInterval(()=>{try{write();}catch{}},5000);write();const initial=readSettings();state.intervalMinutes=initial.intervalMinutes;state.syncOnStart=initial.syncOnStart;if(!initial.syncOnStart)await waitForNext(Date.now());while(!stopping){await runOne();if(stopping)break;await waitForNext(Date.now());}state.schedulerState=process.exitCode===75?'STOPPING':'STOPPED';state.nextRunAt=null;write();}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{stopping=true;if(!running){state.schedulerState='STOPPING';state.nextRunAt=null;try{write();}catch{}}});
try{await main();}finally{if(heartbeat)clearInterval(heartbeat);if(process.exitCode===75)setTimeout(()=>process.exit(75),1000).unref();}
