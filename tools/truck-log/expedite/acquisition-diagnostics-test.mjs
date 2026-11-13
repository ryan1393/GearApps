// Local filesystem + actual production download function, with no RXO requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { acquireOnce, acquisitionStatus, verifyLatest, ACQUISITION_STAGES, ACQUISITION_CAUSES } from '../../../apps/rxo-expedite/src/lib/acquisition.mjs';
import { saveCredentials } from '../../../apps/rxo-expedite/src/lib/credentials.mjs';
import { ExpediteError } from '../../../apps/rxo-expedite/src/lib/workbook.mjs';
import { RxoAuthError } from '../../../libs/truck-log/rxo-shared/rxo-auth.mjs';
import { assertFreightSession, excelControls, openFreightList } from '../../../apps/rxo-expedite/src/lib/list-view.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const sample=fs.readFileSync(path.join(here,'fixtures','Freight On The Move.xlsx'));
const production=fs.readFileSync(path.join(here,'../../../apps/rxo-expedite/src/lib/acquisition.mjs'),'utf8');
const start=production.indexOf('export async function downloadNative('),end=production.indexOf('export function fullStatus(',start);
assert(start>=0&&end>start);
const actualDownload=production.slice(start,end).replace('export async function','async function');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function nativeFixture(kind){
 let now=0,clicks=0,saves=0;
 const stages=[];
 const download={suggestedFilename:()=> 'fixture.xlsx',failure:async()=>null};
 const locator=(target='')=>({
  filter:({hasText})=>locator(hasText.source.includes('list')?'list':'export'),
  or(){return this;},first(){return this;},waitFor:async()=>{},count:async()=>1,
  click(){
   if(target!=='export')return Promise.resolve();
   clicks++;
   if(kind==='sync-click-fails')throw Error('synthetic click failure');
   if(kind==='click-fails-first')return delay(0).then(()=>{const e=Error('synthetic click timeout');e.name='TimeoutError';throw e;});
   return delay(kind==='download-fails-first'?30:0);
  }
 });
 const page={
  url:()=> 'https://www.expedite.rxo.com/WebClient/#/freight-on-the-move',frames:()=>[],
  setDefaultTimeout(){},locator,evaluate:async()=> '11 of 11 Shipments',waitForTimeout:async()=>{},
  waitForEvent(){
   if(kind==='success')return Promise.resolve(download);
   return delay(kind==='download-fails-first'?0:15).then(()=>{throw Error('synthetic download failure');});
  }
 };
 const sandbox={
  console:{log(){}},Date:{now:()=>now+=1000},ExpediteError,RxoAuthError,
  authenticateExpedite:async()=>({passwordSubmissions:0}),
  assertFreightSession,excelControls,openFreightList,
  must:(condition,code)=>{if(!condition)throw new ExpediteError(code);},
  context:{pages:()=>[page]},save:async value=>{assert.equal(value,download);saves++;},
  options:{auth:{},onStage:value=>stages.push(value)}
 };
 const result=vm.runInNewContext(actualDownload+';downloadNative(context,{},save,options)',sandbox);
 if(kind==='success')await result;else await assert.rejects(result);
 // Keep the process alive until a rejected download waiter has fired. Under the
 // old implementation the actual Node default unhandled-rejection policy exits1.
 await delay(80);
 assert.equal(clicks,1,'one export click only');
 assert.equal(saves,kind==='success'?1:0);
 for(const stage of stages)assert(ACQUISITION_STAGES.includes(stage));
 if(kind==='success')assert.equal(stages.at(-1),'DOWNLOAD_SAVE');
}
const childCase=process.argv.find(value=>value.startsWith('--download-case='));
if(childCase){await nativeFixture(childCase.slice('--download-case='.length));process.exit(0);}

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'truck-log-expedite-diagnostics-'));
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const nativeMessage='password=fixture-private-password https://private.invalid/?token=fixture-private-token /private/profile/location';
const tests=[];const test=(name,action)=>tests.push({name,action});
function listFixture(options={}){
 let exports=options.ready?1:0,clicks=0,checks=0,clickedOptions;
 const locator=(kind='')=>({
  filter:({hasText})=>locator(hasText.source.includes('list')?(kind==='label'?'label':'list'):'export'),
  or(){return this;},and(){return this;},first(){return this;},
  waitFor:async()=>{if(options.missing)throw Object.assign(Error(),{name:'TimeoutError'});},
  count:async()=>kind==='export'?exports:kind==='list'?(options.controls??1):kind==='label'?(options.labels??0):kind==='radio'?(options.radios??0):kind==='password'?(options.password?1:0):kind==='otp'?(options.otp?1:0):0,
  click:async value=>{clicks++;clickedOptions=value;if(options.renderOnClick)exports=1;if(options.clickError)throw options.clickError;},
  check:async value=>{checks++;clickedOptions=value;exports=1;},
 });
 const page={url:()=>options.url??'https://www.expedite.rxo.com/WebClient/#/freight-on-the-move',
  frames:()=>[{locator:selector=>locator(selector.includes('password')?'password':selector.includes('one-time-code')?'otp':'')}],
  locator:selector=>selector==='label:visible'?{...locator('label'),count:async()=>options.labels??0}:locator(),
  getByRole:()=>locator('radio'),
 };
 return {page,clicks:()=>clicks,checks:()=>checks,clickedOptions:()=>clickedOptions};
}
test('restored native List export does not re-click the active List navigation',async()=>{
 const fixture=listFixture({ready:true});await openFreightList(fixture.page);assert.equal(fixture.clicks(),0);
});
test('List is clicked once without waiting for a legacy document navigation',async()=>{
 const fixture=listFixture();await openFreightList(fixture.page,{timeoutMs:250});assert.equal(fixture.clicks(),1);
 assert.deepEqual(fixture.clickedOptions(),{timeout:250,noWaitAfter:true});
});
test('a visible native List radio is checked directly instead of clicking its covered label',async()=>{
 const fixture=listFixture({controls:0,labels:1,radios:1});await openFreightList(fixture.page);
 assert.equal(fixture.checks(),1);assert.equal(fixture.clicks(),0);
 await openFreightList(fixture.page);assert.equal(fixture.checks(),1);
});
test('a timed-out click succeeds only if the native List export actually appeared',async()=>{
 const error=Object.assign(Error('private native call log'),{name:'TimeoutError'});
 const succeeded=listFixture({clickError:error,renderOnClick:true});await openFreightList(succeeded.page);assert.equal(succeeded.clicks(),1);
 const blocked=listFixture({clickError:error});await assert.rejects(openFreightList(blocked.page),e=>e.code==='FREIGHT_LIST_CONTROL_TIMEOUT');assert.equal(blocked.clicks(),1);
});
test('ambiguous and absent List controls fail closed without export or repeated clicks',async()=>{
 for(const options of [{controls:2},{controls:0,labels:2},{missing:true}]){
  const fixture=listFixture(options);await assert.rejects(openFreightList(fixture.page),e=>e.code=== (options.missing?'FREIGHT_LIST_CONTROL_TIMEOUT':'FREIGHT_LIST_CONTROL_REVIEW'));
  assert.equal(fixture.clicks(),0);
 }
});
test('expired sessions and verification overlays return fixed authentication codes',async()=>{
 for(const [options,code]of [[{url:'https://www.expedite.rxo.com/WebClient/Account/Login'},'RXO_AUTH_SESSION_REVIEW'],[{password:true},'RXO_AUTH_SESSION_REVIEW'],[{otp:true},'RXO_AUTH_VERIFICATION_REQUIRED'],[{url:'https://private.invalid/'},'RXO_AUTH_ORIGIN_REVIEW']]){
  const fixture=listFixture(options);await assert.rejects(openFreightList(fixture.page),e=>e instanceof RxoAuthError&&e.code===code);assert.equal(fixture.clicks(),0);
 }
});
function fixture(){
 const root=fs.mkdtempSync(path.join(tmp,'case-')),secret=path.join(root,'secret'),data=path.join(root,'data'),profile=path.join(root,'state','profile');
 fs.mkdirSync(secret);fs.mkdirSync(data);saveCredentials({username:'fixture-user',password:'fixture-private-password'},secret);
 return {root,secretRoot:secret,dataRoot:data,profileRoot:profile};
}
const browser={launchPersistentContext:async()=>({close:async()=>{}})};
const saveSample=async(context,credentials,save)=>save({saveAs:async file=>fs.writeFileSync(file,sample)});
async function failed(s,{error,stage='AUTHENTICATION',launch=false}){
 let closes=0;
 const chromium=launch?{launchPersistentContext:async()=>{throw error;}}:{launchPersistentContext:async()=>({close:async()=>{closes++;}})};
 const savedError=console.error,logs=[];console.error=(...items)=>logs.push(items.join(' '));
 try{await assert.rejects(acquireOnce({...s,chromium,browserFlow:async(context,credentials,save,{onStage})=>{onStage(stage);throw error;}}),e=>e.code===(error instanceof ExpediteError||error instanceof RxoAuthError?error.code:'EXPEDITE_ACQUISITION_FAILED'));}
 finally{console.error=savedError;}
 assert.equal(closes,launch?0:1);
 assert.equal(fs.existsSync(path.join(s.dataRoot,'.expedite-acquisition.lock')),false);
 const health=json(path.join(s.dataRoot,'expedite-health.json'));
 const batch=path.join(s.dataRoot,'batches',health.sourceBatchId);
 const review=json(path.join(batch,'acquisition-review.json'));
 assert.deepEqual(review.diagnostic,health.diagnostic);
 const output=JSON.stringify({health,review,logs});
 for(const secret of ['fixture-private-password','fixture-private-token','private.invalid','/private/profile/location'])assert(!output.includes(secret));
 assert(ACQUISITION_STAGES.includes(health.diagnostic.stage));assert(ACQUISITION_CAUSES.includes(health.diagnostic.cause));
 assert.match(logs.join('\n'),/stage=[A-Z_]+; cause=[A-Z_]+/);
 return health;
}

for(const kind of ['click-fails-first','download-fails-first','sync-click-fails','success'])test('actual download function: '+kind+' observes both promises and clicks once',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--download-case='+kind],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,'actual download child must finish without an unhandled rejection');
 assert.equal(result.stderr,'');
});
test('later failure preserves the earlier verified export and gives its own launch cause',async()=>{
 const s=fixture(),prior=await acquireOnce({...s,chromium:browser,browserFlow:saveSample});
 const error=Error(nativeMessage);error.name='TimeoutError';
 const health=await failed(s,{error,launch:true});
 assert.deepEqual(health.diagnostic,{stage:'BROWSER_LAUNCH',cause:'TIMEOUT'});
 assert.equal(health.errorCode,'EXPEDITE_ACQUISITION_FAILED');
 assert.equal(acquisitionStatus(s.dataRoot).lastSuccess.sourceBatchId,prior.sourceBatchId);
 assert.equal(verifyLatest(s.dataRoot).sourceBatchId,prior.sourceBatchId);
 assert.notEqual(health.sourceBatchId,prior.sourceBatchId);
 assert(Number.isFinite(Date.parse(health.completedAt)));
});
const cases=[
 ['profile lock',{launch:true,message:'ProcessSingleton SingletonLock '+nativeMessage},'PROFILE_BUSY','BROWSER_LAUNCH'],
 ['missing browser',{launch:true,message:"Executable doesn't exist "+nativeMessage},'BROWSER_EXECUTABLE_MISSING','BROWSER_LAUNCH'],
 ['closed browser',{name:'TargetClosedError',stage:'EXPORT_DOWNLOAD'},'BROWSER_CLOSED','EXPORT_DOWNLOAD'],
 ['network error',{stage:'LIST_DATA',message:'net::ERR_CONNECTION_RESET '+nativeMessage},'NETWORK_ERROR','LIST_DATA'],
 ['disk full',{stage:'DOWNLOAD_SAVE',code:'ENOSPC'},'DISK_FULL','DOWNLOAD_SAVE'],
 ['quota full',{stage:'DOWNLOAD_SAVE',code:'EDQUOT'},'DISK_FULL','DOWNLOAD_SAVE'],
 ['permission denied',{stage:'PUBLICATION',code:'EACCES'},'PERMISSION_DENIED','PUBLICATION'],
 ['read-only filesystem',{stage:'DOWNLOAD_SAVE',code:'EROFS'},'PERMISSION_DENIED','DOWNLOAD_SAVE'],
 ['filesystem error',{stage:'PUBLICATION',code:'EIO'},'FILESYSTEM_ERROR','PUBLICATION'],
 ['cancelled download',{stage:'DOWNLOAD_SAVE',message:'download.saveAs: canceled '+nativeMessage},'DOWNLOAD_FAILED','DOWNLOAD_SAVE'],
 ['unknown native error',{stage:'LIST_CONTROL'},'UNEXPECTED','LIST_CONTROL'],
 ['invalid reported stage',{stage:nativeMessage},'UNEXPECTED','AUTHENTICATION'],
];
for(const [label,options,cause,stage]of cases)test('failure classification: '+label,async()=>{
 const error=Object.assign(Error(options.message??nativeMessage),{...(options.name?{name:options.name}:{}),...(options.code?{code:options.code}:{})});
 const health=await failed(fixture(),{...options,error});assert.deepEqual(health.diagnostic,{stage,cause});
});
test('known auth and download errors retain backward-compatible codes',async()=>{
 for(const [error,stage,cause]of [[new RxoAuthError('RXO_AUTH_NAVIGATION_REVIEW'),'AUTHENTICATION','AUTHENTICATION_FAILED'],[new ExpediteError('EXPORT_DOWNLOAD_FAILED'),'DOWNLOAD_SAVE','DOWNLOAD_FAILED'],[new ExpediteError('EXPEDITE_EXPORT_TIMEOUT'),'EXPORT_CONTROL','TIMEOUT']]){
  const health=await failed(fixture(),{error,stage});assert.deepEqual(health.diagnostic,{stage,cause});assert.equal(health.errorCode,error.code);
 }
});
test('actual workbook validation stage retains schema code and preserves prior latest',async()=>{
 const s=fixture(),prior=await acquireOnce({...s,chromium:browser,browserFlow:saveSample});
 const original=console.error;console.error=()=>{};
 try{await assert.rejects(acquireOnce({...s,chromium:browser,browserFlow:async(c,credentials,save)=>save({saveAs:async file=>fs.writeFileSync(file,'not-a-workbook')})}),e=>e.code==='XLSX_SIZE_REVIEW');}
 finally{console.error=original;}
 const status=acquisitionStatus(s.dataRoot);assert.deepEqual(status.diagnostic,{stage:'WORKBOOK_VALIDATION',cause:'VALIDATION_FAILED'});assert.equal(status.lastSuccess.sourceBatchId,prior.sourceBatchId);
});
test('download save callback records real disk failure without a reporter or publishing partial bytes',async()=>{
 const s=fixture(),prior=await acquireOnce({...s,chromium:browser,browserFlow:saveSample});
 const original=console.error;console.error=()=>{};
 try{await assert.rejects(acquireOnce({...s,chromium:browser,browserFlow:async(c,credentials,save)=>save({saveAs:async file=>{fs.writeFileSync(file,'partial');throw Object.assign(Error(nativeMessage),{code:'ENOSPC'});}})}),e=>e.code==='EXPEDITE_ACQUISITION_FAILED');}
 finally{console.error=original;}
 const status=acquisitionStatus(s.dataRoot);assert.deepEqual(status.diagnostic,{stage:'DOWNLOAD_SAVE',cause:'DISK_FULL'});assert.equal(status.lastSuccess.sourceBatchId,prior.sourceBatchId);
 const health=json(path.join(s.dataRoot,'expedite-health.json'));
 assert.equal(fs.readFileSync(path.join(s.dataRoot,'batches',health.sourceBatchId,'Freight On The Move.xlsx.part'),'utf8'),'partial');
 assert.equal(fs.existsSync(path.join(s.dataRoot,'batches',health.sourceBatchId,'rxo-expedite-boundary.json')),false);
});
test('status supports legacy health and exposes only allowlisted diagnostic fields',async()=>{
 const s=fixture();await acquireOnce({...s,chromium:browser,browserFlow:saveSample});
 const file=path.join(s.dataRoot,'expedite-health.json'),health=json(file);delete health.diagnostic;
 fs.writeFileSync(file,JSON.stringify(health));assert.equal(acquisitionStatus(s.dataRoot).diagnostic,null);
 for(const diagnostic of [{stage:nativeMessage,cause:'TIMEOUT'},{stage:'BROWSER_LAUNCH',cause:nativeMessage},null,'invalid']){
  fs.writeFileSync(file,JSON.stringify({...health,diagnostic}));assert.equal(acquisitionStatus(s.dataRoot).diagnostic,null);
 }
 fs.writeFileSync(file,JSON.stringify({...health,diagnostic:{stage:'BROWSER_LAUNCH',cause:'TIMEOUT',message:nativeMessage,stack:nativeMessage}}));
 assert.deepEqual(acquisitionStatus(s.dataRoot).diagnostic,{stage:'BROWSER_LAUNCH',cause:'TIMEOUT'});
});

// Atomic publication uses native Linux symlinks; Windows fixture checks must not
// request elevation or replace those semantics with a fake filesystem.
const linuxPublicationCases=new Set([
 'later failure preserves the earlier verified export and gives its own launch cause',
 'actual workbook validation stage retains schema code and preserves prior latest',
 'download save callback records real disk failure without a reporter or publishing partial bytes',
 'status supports legacy health and exposes only allowlisted diagnostic fields',
]);
let passed=0,skipped=0;try{for(const {name,action}of tests){if(process.platform==='win32'&&linuxPublicationCases.has(name)){skipped++;console.log('[SKIP - Linux filesystem case] '+name);continue;}await action();passed++;console.log('[PASS] '+name);}console.log(`EXPEDITE ACQUISITION DIAGNOSTICS: ${passed}/${tests.length-skipped} PASS; ${skipped} Linux-only cases skipped; no live RXO access.`);}
finally{fs.rmSync(tmp,{recursive:true,force:true});}
