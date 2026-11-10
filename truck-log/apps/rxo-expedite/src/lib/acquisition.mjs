import { authenticateExpedite, assertAuthMayRun, readExpediteGeneration, RxoAuthError } from './rxo-auth.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SOURCE, ExpediteError, validateWorkbook, sha256 } from './workbook.mjs';
import { readCredentials, credentialStatus } from './credentials.mjs';
import { acquireLock, inspectLock, withTimeout } from './process-lock.mjs';
import { pruneBatchDirectories } from './batch-retention.mjs';
import { assertFreightSession, excelControls, freightViewCovered, openFreightList } from './list-view.mjs';
export const VERSION=process.env.TRUCK_LOG_RELEASE||'1.0.8';
export const LOGIN_URL='https://www.expedite.rxo.com/WebClient/Account/Login';
export const FREIGHT_URL='https://www.expedite.rxo.com/WebClient/#/freight-on-the-move';
export const XLSX_NAME='Freight On The Move.xlsx';
export const BOUNDARY_NAME='rxo-expedite-boundary.json';
const must=(b,c)=>{if(!b)throw new ExpediteError(c);};
const present=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const validId=s=>typeof s==='string'&&/^\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(s);
const safeError=e=>(e instanceof ExpediteError||e instanceof RxoAuthError)?e.code:'EXPEDITE_ACQUISITION_FAILED';
// Diagnostic values cross the worker/API boundary. Never retain native messages,
// call logs, URLs, stacks or paths: classify them into these fixed public enums.
export const ACQUISITION_STAGES=Object.freeze(['PREPARATION','BROWSER_LAUNCH','AUTHENTICATION','LIST_CONTROL','LIST_DATA','EXPORT_CONTROL','EXPORT_DOWNLOAD','DOWNLOAD_SAVE','WORKBOOK_VALIDATION','PUBLICATION']);
export const ACQUISITION_CAUSES=Object.freeze(['TIMEOUT','PROFILE_BUSY','BROWSER_CLOSED','BROWSER_EXECUTABLE_MISSING','NETWORK_ERROR','DISK_FULL','PERMISSION_DENIED','FILESYSTEM_ERROR','DOWNLOAD_FAILED','VALIDATION_FAILED','AUTHENTICATION_FAILED','UNEXPECTED']);
const safeDiagnostic=value=>value&&ACQUISITION_STAGES.includes(value.stage)&&ACQUISITION_CAUSES.includes(value.cause)?{stage:value.stage,cause:value.cause}:null;
function failureDiagnostic(error,stage){
 const code=typeof error?.code==='string'?error.code:'',message=typeof error?.message==='string'?error.message:'';
 let cause='UNEXPECTED';
 if(['ENOSPC','EDQUOT'].includes(code))cause='DISK_FULL';
 else if(['EACCES','EPERM','EROFS'].includes(code))cause='PERMISSION_DENIED';
 else if(['ENOENT','EIO','EMFILE','ENFILE','EISDIR','ENOTDIR','EEXIST','ENAMETOOLONG','ELOOP','EBUSY','EXDEV','ENOTEMPTY','EINVAL','EFBIG'].includes(code))cause='FILESYSTEM_ERROR';
 else if(error?.name==='TimeoutError'||((error instanceof ExpediteError||error instanceof RxoAuthError)&&code.includes('TIMEOUT')))cause='TIMEOUT';
 else if(stage==='BROWSER_LAUNCH'&&/ProcessSingleton|SingletonLock|profile[^\n]*(?:in use|locked)|user data directory[^\n]*already in use/i.test(message))cause='PROFILE_BUSY';
 else if(stage==='BROWSER_LAUNCH'&&/executable[^\n]*(?:doesn't exist|does not exist|not found)|browser[^\n]*executable[^\n]*missing/i.test(message))cause='BROWSER_EXECUTABLE_MISSING';
 else if(error?.name==='TargetClosedError'||/target (?:page, context or browser|page|context|browser)[^\n]*(?:closed|crashed)|browser (?:has been |was )?(?:closed|crashed)|page crashed/i.test(message))cause='BROWSER_CLOSED';
 else if(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT'].includes(code)||/net::ERR_[A-Z_]+|ERR_NAME_NOT_RESOLVED|ERR_CERT_[A-Z_]+|network[^\n]*(?:failed|error|changed|unavailable)/i.test(message))cause='NETWORK_ERROR';
 else if(error instanceof RxoAuthError)cause='AUTHENTICATION_FAILED';
 else if(code==='EXPORT_DOWNLOAD_FAILED'||(['EXPORT_DOWNLOAD','DOWNLOAD_SAVE'].includes(stage)&&/cancelled|canceled|download[^\n]*(?:failed|failure)/i.test(message)))cause='DOWNLOAD_FAILED';
 else if(error instanceof ExpediteError)cause='VALIDATION_FAILED';
 return {stage:ACQUISITION_STAGES.includes(stage)?stage:'PREPARATION',cause};
}
function realDir(p,create=false){if(!fs.existsSync(p)&&create)fs.mkdirSync(p,{recursive:true,mode:0o700});const s=fs.lstatSync(p);must(s.isDirectory()&&!s.isSymbolicLink(),'ACQUISITION_PATH_REVIEW');return p;}
function readSmall(p,max){const s=fs.lstatSync(p);must(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'ACQUISITION_PATH_REVIEW');return fs.readFileSync(p);}
function writeAtomic(p,bytes){const temp=p+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});fs.renameSync(temp,p);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
const json=(p,v)=>writeAtomic(p,JSON.stringify(v,null,2)+'\n');
// Every await of a run is bounded, so one acquisition (and the lock) lasts at most
// LAUNCH + EXPORT + CLOSE. A lock older than that, or whose holder died or stopped
// refreshing it, is broken by the next run instead of blocking the scheduler forever.
export const LAUNCH_TIMEOUT_MS=120000,EXPORT_TIMEOUT_MS=480000,CLOSE_TIMEOUT_MS=30000;
export const MAX_ACQUISITION_MS=LAUNCH_TIMEOUT_MS+EXPORT_TIMEOUT_MS+CLOSE_TIMEOUT_MS;
const LOCK_NAME='.expedite-acquisition.lock';
const LOCK_OPTIONS={staleAfterMs:120000,maxHoldMs:MAX_ACQUISITION_MS+5*60000};
let browserCloseStuck=false;
/** True after Chromium failed to close in time; the scheduler restarts its container to reap it. */
export function browserCloseTimedOut(){return browserCloseStuck;}
function latestDirectory(root){
 const p=path.join(root,'latest');if(!present(p))return null;
 must(fs.lstatSync(p).isSymbolicLink(),'BOUNDARY_REVIEW');const target=fs.readlinkSync(p);
 must(/^batches\/[^/]+$/.test(target)&&validId(target.slice(8)),'BOUNDARY_REVIEW');
 const dir=path.join(root,target);realDir(path.join(root,'batches'));realDir(dir);return dir;
}
function verifyBatch(dir){
 realDir(dir);
 const b=JSON.parse(readSmall(path.join(dir,BOUNDARY_NAME),64*1024).toString('utf8'));
 must(b.contractVersion===1&&b.source===SOURCE&&b.dataset==='FREIGHT_ON_THE_MOVE'&&b.sourceBatchId===path.basename(dir)&&b.xlsxPath===XLSX_NAME&&b.rawPath==='rxo-expedite-raw.json'&&Number.isFinite(Date.parse(b.completedAt)),'BOUNDARY_REVIEW');
 const bytes=readSmall(path.join(dir,XLSX_NAME),20*1024*1024),v=validateWorkbook(bytes),raw=readSmall(path.join(dir,b.rawPath),64*1024*1024);
 must(v.xlsxSHA256===b.xlsxSHA256&&v.xlsxBytes===b.xlsxBytes&&v.rowCount===b.rowCount&&JSON.stringify(v.observedHeaders)===JSON.stringify(b.observedHeaders)&&sha256(raw)===b.rawSHA256,'BOUNDARY_REVIEW');
 return {sourceBatchId:b.sourceBatchId,completedAt:b.completedAt,rowCount:b.rowCount,observedHeaders:b.observedHeaders,contractVersion:b.contractVersion,verified:true};
}
function latestNonEmptyBaseline(root,limit=24){
 const batches=path.join(root,'batches');realDir(batches);const names=fs.readdirSync(batches,{withFileTypes:true}).filter(d=>d.isDirectory()&&validId(d.name)).map(d=>d.name).sort().reverse().slice(0,limit);
 for(const name of names){try{const v=verifyBatch(path.join(batches,name));if(v.rowCount>0)return v;}catch{}}
 return null;
}
// Retention: newest verified batches and newest failed/partial batches; the latest
// target and the zero-row baseline are never removed.
export const KEEP_SUCCESSFUL_BATCHES=48,KEEP_FAILED_BATCHES=20;
export function pruneExpediteBatches(root,protect=[]){
 const batches=path.join(root,'batches');if(!present(batches))return {removed:[],kept:[]};
 let latest=null,baseline=null;try{latest=latestDirectory(root);}catch{}try{baseline=latestNonEmptyBaseline(root);}catch{}
 return pruneBatchDirectories(batches,{keepSuccessful:KEEP_SUCCESSFUL_BATCHES,keepFailed:KEEP_FAILED_BATCHES,
  protect:[...protect,latest&&path.basename(latest),baseline?.sourceBatchId],validName:validId,
  isSuccessful:(name,dir)=>fs.lstatSync(path.join(dir,BOUNDARY_NAME)).isFile(),log:m=>console.log('[RXO EXPEDITE] '+m)});
}
// A genuinely empty Freight on the Move list (no expedite freight) is accepted by scheduled
// runs only after it has been seen twice: an uncovered, steady "0 of 0" list exports zero rows
// in one scan, and again in a later scan at least EMPTY_CONFIRM_MIN_MS afterwards with no
// non-empty result between. The first sighting keeps the previous batch published.
export const EMPTY_LIST_STABLE_MS=20000,EMPTY_CONFIRM_MIN_MS=10*60000,EMPTY_CONFIRM_MAX_MS=6*60*60000;
const EMPTY_MARKER='expedite-empty-list.json';
function readEmptyMarker(root){
 try{const m=JSON.parse(readSmall(path.join(root,EMPTY_MARKER),4096).toString('utf8'));
  if(m?.contractVersion!==1||m.source!==SOURCE)return null;
  if(m.state==='OBSERVED'&&Number.isFinite(Date.parse(m.firstObservedAt)))return {state:'OBSERVED',firstObservedAt:m.firstObservedAt};
  if(m.state==='CONFIRMED'&&validId(m.sourceBatchId))return {state:'CONFIRMED',sourceBatchId:m.sourceBatchId};
 }catch{}
 return null;
}
const writeEmptyMarker=(root,value)=>json(path.join(root,EMPTY_MARKER),{contractVersion:1,source:SOURCE,...value});
function clearEmptyMarker(root){try{fs.unlinkSync(path.join(root,EMPTY_MARKER));}catch(e){if(e.code!=='ENOENT')throw e;}}
export function shouldRejectZeroRegression(protectZeroRegression,rowCount,baselineRowCount){return protectZeroRegression===true&&rowCount===0&&Number.isSafeInteger(baselineRowCount)&&baselineRowCount>0;}
export function verifyLatest(root='/app/data'){
 realDir(root);const dir=latestDirectory(root);return dir?verifyBatch(dir):null;
}
export function acquisitionStatus(root='/app/data'){
 realDir(root);let latest=null,health=null;
 try{latest=verifyLatest(root);}catch{return {state:'REVIEW',lastError:'BOUNDARY_REVIEW',lastSuccess:null};}
 try{const p=path.join(root,'expedite-health.json');if(fs.existsSync(p)){const h=JSON.parse(readSmall(p,16384).toString('utf8'));if(h.source===SOURCE&&['RUNNING','SUCCESS','REVIEW','FAILED'].includes(h.state))health=h;else throw Error();}}
 catch{return{state:'REVIEW',lastError:'HEALTH_REVIEW',lastSuccess:latest};}
 const lock=inspectLock(path.join(root,LOCK_NAME),LOCK_OPTIONS),locked=lock.present&&!lock.stale;
 let state=health?.state??'NOT_RUN',error=health?.errorCode??null;
 if(locked&&(state!=='RUNNING'||!Number.isFinite(Date.parse(health?.startedAt))||Date.now()-Date.parse(health?.startedAt)>MAX_ACQUISITION_MS+60000)){state='REVIEW';error='ACQUISITION_LOCK_REVIEW';}
 if(state==='RUNNING'&&!locked){state='REVIEW';error='INTERRUPTED_ACQUISITION';}
 return {state,lastError:typeof error==='string'&&/^[A-Z0-9_]{1,80}$/.test(error)?error:null,diagnostic:safeDiagnostic(health?.diagnostic),lastSuccess:latest,lastAttemptAt:health?.startedAt??null,completedAt:health?.completedAt??null,lockPresent:lock.present,lockStale:lock.stale};
}
/** No retry loop, scheduler, ingestion, screenshot, console forwarding or HAR capture. */
export async function acquireOnce({chromium,secretRoot='/run/secrets',dataRoot='/app/data',profileRoot='/app/state/expedite-profile',browserFlow=downloadNative,protectZeroRegression=false}={}){
 assertAuthMayRun(dataRoot, 'expedite');
 const authGeneration=readExpediteGeneration(secretRoot);
 const credentials=readCredentials(secretRoot); // Fail BEFORE browser launch if missing.
 if(readExpediteGeneration(secretRoot)!==authGeneration)throw new RxoAuthError('RXO_AUTH_CREDENTIALS_CHANGED');
 must(chromium,'BROWSER_RUNTIME_MISSING');realDir(dataRoot,true);realDir(path.dirname(profileRoot),true);realDir(profileRoot,true);
 let lock;
 try{lock=acquireLock(path.join(dataRoot,LOCK_NAME),{...LOCK_OPTIONS,code:'EXPEDITE_ACQUISITION_BUSY',purpose:'expedite acquisition',heartbeatMs:30000,log:m=>console.log('[RXO EXPEDITE] '+m)});}
 catch(e){if(e?.code==='EXPEDITE_ACQUISITION_BUSY')throw new ExpediteError('EXPEDITE_ACQUISITION_BUSY');throw new ExpediteError('ACQUISITION_PATH_REVIEW');}
 const startedAt=new Date().toISOString(),batchId=startedAt.replace(/[-:.]/g,'')+'-'+randomUUID();
 const batch=path.join(dataRoot,'batches',batchId);
 let context=null,timer,batchCreated=false,stage='PREPARATION';
 const onStage=next=>{if(ACQUISITION_STAGES.includes(next))stage=next;};
 const state=(s,errorCode=null,diagnostic=null)=>json(path.join(dataRoot,'expedite-health.json'),{contractVersion:1,source:SOURCE,version:VERSION,state:s,sourceBatchId:batchId,startedAt,completedAt:s==='RUNNING'?null:new Date().toISOString(),errorCode,diagnostic});
 try{
  must(validId(batchId),'BATCH_ID_REVIEW');
  realDir(path.join(dataRoot,'batches'),true);fs.mkdirSync(batch,{mode:0o700});batchCreated=true;
  // Validate any existing alias before opening a browser or changing publication. Scheduled runs
  // also keep a fully-verified non-empty baseline so an already-published empty regression cannot
  // weaken future zero-row protection.
  let currentVerified=null,zeroRowBaseline=null;
  if(present(path.join(dataRoot,'latest'))){currentVerified=verifyLatest(dataRoot);if(protectZeroRegression)zeroRowBaseline=latestNonEmptyBaseline(dataRoot);}
  // A confirmed empty list that is still the published batch stays published: do not restore
  // the older non-empty batch, and accept further empty scans without a new confirmation.
  const emptyMarker=protectZeroRegression?readEmptyMarker(dataRoot):null;
  const emptyAccepted=emptyMarker?.state==='CONFIRMED'&&currentVerified?.rowCount===0&&emptyMarker.sourceBatchId===currentVerified.sourceBatchId;
  if(emptyAccepted)zeroRowBaseline=null;
  let emptyConfirmed=false;
  if(protectZeroRegression&&currentVerified?.rowCount===0&&zeroRowBaseline?.rowCount>0&&currentVerified.sourceBatchId!==zeroRowBaseline.sourceBatchId){
   const pointer=path.join(dataRoot,'.latest-recover-'+randomUUID());try{fs.symlinkSync('batches/'+zeroRowBaseline.sourceBatchId,pointer,'dir');latestDirectory(dataRoot);fs.renameSync(pointer,path.join(dataRoot,'latest'));}finally{if(present(pointer))fs.unlinkSync(pointer);}
   currentVerified=zeroRowBaseline;
  }
  state('RUNNING');
  onStage('BROWSER_LAUNCH');
  const launching=Promise.resolve(chromium.launchPersistentContext(profileRoot,{headless:true,acceptDownloads:true,ignoreHTTPSErrors:false,viewport:{width:1440,height:960}}));
  try{context=await withTimeout(launching,LAUNCH_TIMEOUT_MS,'EXPEDITE_BROWSER_LAUNCH_TIMEOUT');}
  catch(e){if(e?.code==='EXPEDITE_BROWSER_LAUNCH_TIMEOUT'){launching.then(late=>late?.close?.()).catch(()=>{});throw new ExpediteError('EXPEDITE_BROWSER_LAUNCH_TIMEOUT');}throw e;}
  onStage('AUTHENTICATION');
  const pending=browserFlow(context,credentials,async download=>{
   onStage('DOWNLOAD_SAVE');
   const file=path.join(batch,XLSX_NAME+'.part');await download.saveAs(file);fs.renameSync(file,path.join(batch,XLSX_NAME));
  },{preferNonEmpty:protectZeroRegression&&(zeroRowBaseline?.rowCount??0)>0,onStage,
   auth:{dataRoot,sessionRoot:profileRoot,generation:authGeneration,
     checkGeneration:()=>readExpediteGeneration(secretRoot)}});
  await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ExpediteError('EXPEDITE_EXPORT_TIMEOUT')),EXPORT_TIMEOUT_MS);})]);
  onStage('WORKBOOK_VALIDATION');
  const bytes=readSmall(path.join(batch,XLSX_NAME),20*1024*1024),parsed=validateWorkbook(bytes);
  if(shouldRejectZeroRegression(protectZeroRegression,parsed.rowCount,zeroRowBaseline?.rowCount??0)){
   const now=Date.now(),first=emptyMarker?.state==='OBSERVED'?Date.parse(emptyMarker.firstObservedAt):NaN,age=now-first;
   if(!(age>=EMPTY_CONFIRM_MIN_MS&&age<=EMPTY_CONFIRM_MAX_MS)){
    // First sighting, or a stale one: start the confirmation window. A repeat that arrives too soon keeps the original time.
    if(!(age>=0&&age<EMPTY_CONFIRM_MIN_MS))writeEmptyMarker(dataRoot,{state:'OBSERVED',firstObservedAt:new Date(now).toISOString()});
    throw new ExpediteError('EMPTY_LIST_AWAITING_SECOND_SCAN');
   }
   emptyConfirmed=true;
  }
  onStage('PUBLICATION');
  const raw=Buffer.from(JSON.stringify(parsed,null,2)+'\n');fs.writeFileSync(path.join(batch,'rxo-expedite-raw.json'),raw,{flag:'wx',mode:0o600});
  const completedAt=new Date().toISOString(),boundary={contractVersion:1,source:SOURCE,sourceBatchId:batchId,completedAt,dataset:'FREIGHT_ON_THE_MOVE',xlsxPath:XLSX_NAME,xlsxSHA256:parsed.xlsxSHA256,xlsxBytes:bytes.length,rawPath:'rxo-expedite-raw.json',rawSHA256:sha256(raw),rowCount:parsed.rowCount,observedHeaders:parsed.observedHeaders,sheetName:parsed.sheetName,dateSystem:parsed.dateSystem,etaTimezone:null,scope:'Native Freight On The Move export; live filter/completeness verification required',ingestion:'NOT_IMPLEMENTED'};
  fs.writeFileSync(path.join(batch,BOUNDARY_NAME),JSON.stringify(boundary,null,2)+'\n',{flag:'wx',mode:0o600});
  // Fully verify immutable artifact + manifest BEFORE publishing the new latest alias.
  const verified=verifyBatch(batch);must(verified.sourceBatchId===batchId,'BOUNDARY_REVIEW');
  const pointer=path.join(dataRoot,'.latest-'+randomUUID());
  try{fs.symlinkSync('batches/'+batchId,pointer,'dir');
   const current=path.join(dataRoot,'latest');if(present(current))latestDirectory(dataRoot);fs.renameSync(pointer,current);
  }finally{if(present(pointer))fs.unlinkSync(pointer);}
  if(protectZeroRegression){
   if(parsed.rowCount===0&&(emptyConfirmed||emptyAccepted))writeEmptyMarker(dataRoot,{state:'CONFIRMED',sourceBatchId:batchId});
   else clearEmptyMarker(dataRoot);
  }
  state('SUCCESS');return verified;
 }catch(error){const code=safeError(error),diagnostic=failureDiagnostic(error,stage);
  console.error('[RXO EXPEDITE] '+code+'; stage='+diagnostic.stage+'; cause='+diagnostic.cause);
  try{if(batchCreated)json(path.join(batch,'acquisition-review.json'),{source:SOURCE,sourceBatchId:batchId,startedAt,failedAt:new Date().toISOString(),errorCode:code,diagnostic});state(code.includes('REVIEW')||code.includes('SCHEMA')||code.includes('DUPLICATE')?'REVIEW':'FAILED',code,diagnostic);}catch{}
  throw new ExpediteError(code);
 }finally{clearTimeout(timer);credentials.password='';
  if(context)await withTimeout(context.close(),CLOSE_TIMEOUT_MS,'EXPEDITE_BROWSER_CLOSE_TIMEOUT').catch(e=>{if(e?.code==='EXPEDITE_BROWSER_CLOSE_TIMEOUT'){browserCloseStuck=true;console.error('[RXO EXPEDITE] Chromium did not close within 30 seconds.');}});
  try{if(batchCreated)pruneExpediteBatches(dataRoot,[batchId]);}catch{}
  lock.release();}
}
export async function downloadNative(context,credentials,save,{preferNonEmpty=false,auth,onStage=()=>{}}={}){
 if(!auth)throw new RxoAuthError('RXO_AUTH_STATE_REVIEW');
 onStage('AUTHENTICATION');
 const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(30000);
 const result=await authenticateExpedite(page,{...credentials,...auth});
 console.log('[RXO AUTH] Expedite sign-in verified; password submissions: '+result.passwordSubmissions);
 // A fresh Freight On The Move route opens in Map mode. The native Excel export is rendered
 // only after switching to List, so select that exact visible control before looking for export.
 onStage('LIST_CONTROL');
 await openFreightList(page);
 // Do not export until the list summary is visible, complete, and stable. If a prior verified
 // non-empty batch exists, a transient 0-of-0 list is never considered ready for a scheduled run.
 // RXO can render the shipment summary through nested/duplicated legacy DOM nodes. Use the
 // browser's visible rendered text first, then a stable visible-row fallback when no summary text
 // is exposed. The native workbook validation + zero-row publication guard remain authoritative.
 onStage('LIST_DATA');
 let stableReadiness='',stableSince=0,listReady=false,steadyMs=3000;const readyDeadline=Date.now()+90000;
 while(Date.now()<readyDeadline){
  await assertFreightSession(page);
  const summary=await page.evaluate(()=>{
   const text=(document.body?.innerText||'').replace(/\r/g,' ');
   const m=/(\d+)\s+of\s+(\d+)\s+Shipments/i.exec(text);
   return m?`${m[1]} of ${m[2]} Shipments`:'';
  });
  const m=/^(\d+)\s+of\s+(\d+)\s+Shipments$/i.exec(String(summary).trim());
  const visibleRows=await page.locator('table:visible tbody tr:visible').count();
  let acceptable=false,key='';
  if(m){
   const shown=Number(m[1]),total=Number(m[2]);must(Number.isSafeInteger(shown)&&Number.isSafeInteger(total)&&shown>=0&&total>=0&&shown<=total,'FREIGHT_LIST_DATA_REVIEW');
   if(preferNonEmpty&&total===0){
    // RXO shows "0 of 0" while it is still loading. Believe an empty list only once its
    // loading overlay is gone and the count has stayed at zero for a sustained period.
    acceptable=!(await freightViewCovered(page));key='empty:0/0';steadyMs=EMPTY_LIST_STABLE_MS;
   }else{acceptable=shown===total;key=`summary:${shown}/${total}`;steadyMs=3000;}
  }else{
   acceptable=visibleRows>0;key=`rows:${visibleRows}`;steadyMs=3000;
  }
  if(!acceptable){stableReadiness='';stableSince=0;}
  else if(key===stableReadiness){if(Date.now()-stableSince>=steadyMs){listReady=true;break;}}
  else{stableReadiness=key;stableSince=Date.now();}
  await page.waitForTimeout(500);
 }
 must(listReady,'FREIGHT_LIST_DATA_REVIEW');
 // The List view owns the native Export to Excel control. Keep exact-label and fail-closed rules.
 onStage('EXPORT_CONTROL');
 const interactiveExport=excelControls(page);
 await interactiveExport.first().waitFor({state:'visible',timeout:90000}).catch(async()=>{await assertFreightSession(page);throw new ExpediteError('EXPORT_CONTROL_REVIEW');});
 must(await interactiveExport.count()===1,'EXPORT_CONTROL_REVIEW');const target=interactiveExport.first();
 onStage('EXPORT_DOWNLOAD');
 // Observe both promises before clicking. A failed click or an early download
 // timeout must not leave an orphan rejection that terminates the scheduler.
 const downloadPromise=page.waitForEvent('download',{timeout:180000});
 const [download]=await Promise.all([downloadPromise,Promise.resolve().then(()=>target.click())]);
 const name=download.suggestedFilename();must(/\.xlsx$/i.test(name),'EXPORT_NOT_XLSX');
 // Download bytes are retained before schema validation. No source values are logged.
 onStage('DOWNLOAD_SAVE');
 await save(download);must(await download.failure()===null,'EXPORT_DOWNLOAD_FAILED');
}
export function fullStatus(secretRoot='/run/secrets',dataRoot='/app/data'){
 return {source:SOURCE,version:VERSION,schedulingEnabled:false,databaseIngestionEnabled:false,credentials:credentialStatus(secretRoot),acquisition:acquisitionStatus(dataRoot)};
}
