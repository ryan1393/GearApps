import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const rxjs = require('rxjs');
const focused = [];
const decorator = () => value => value;
const mocks = {
  '@angular/core': { Component: decorator, Injectable: decorator, inject: () => ({}) },
  '@angular/common': {}, '@angular/router': {}, '@angular/common/http': {},
  '@truck-log/web/auth/admin': {}, '@truck-log/shared/contracts': {}, '@truck-log/web/data-access': {}, '@truck-log/web/ui': {},
  './rxo-control-center.presenter': { buildRxoControlView: () => ({scanRunning:false,scanNeedsReview:true}) },
  './rxo-data.store': {}, './rxo-data-table.component': {},
  './rxo-settings-panel.component': { emptyRxoSettingsForm: () => ({}), applyRxoSettings() {} },
  './rxo-expedite/rxo-expedite.component': {}, './rxo-expedite/rxo-expedite.store': {}, rxjs,
};
function load(file) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}});
  vm.runInNewContext(compiled.outputText, {
    module, exports:module.exports, require(name) { assert(name in mocks,`Unexpected dependency ${name}`); return mocks[name]; },
    document:{getElementById:id=>({focus:()=>focused.push(id)})},
    window:{dispatchEvent(){},clearInterval(){}}, CustomEvent:class {},
  }, {filename:file});
  return module.exports;
}
mocks['@truck-log/web/data-access'].rxoRecoveryErrorMessage = load('libs/truck-log/web/data-access/src/lib/rxo-recovery-feedback.ts').rxoRecoveryErrorMessage;
const standardFile='libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-control-center.component.ts';
const expediteFile='libs/truck-log/web/feature/rxo-expedite-control-center/src/lib/rxo-expedite-control-center.component.ts';
const {RxoControlCenterComponent}=load(standardFile);
const {RxoExpediteControlCenterComponent}=load(expediteFile);
const {TruckLogApi}=load('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
const metadata=()=>({available:true,reason:'RXO_AUTH_NAVIGATION_REVIEW',message:'Saved session needs a controlled fresh login.',requiresCredentials:false,requiresInteractiveLogin:false,cooldownUntil:null});
function fixture(kind) {
  const action=new rxjs.Subject();
  let requests=0,refreshes=0,admin=true;
  const errors=[];
  const api={recoverRxoConnection:()=>{requests++;return action;},recoverRxoExpediteConnection:()=>{requests++;return action;}};
  const toast={error:message=>errors.push(message)};
  const auth={canWrite:()=>admin};
  const status={recovery:metadata(),scheduler:{state:'AUTH_HELD',lastErrorCode:'RXO_AUTH_NAVIGATION_REVIEW'},acquisition:{lastError:'RXO_AUTH_NAVIGATION_REVIEW'}};
  let c,read,setStatus;
  if(kind==='standard') {
    c=new RxoControlCenterComponent(api,toast,auth,{});
    c.control={...status,controlAvailable:true,scheduler:{status:'AUTH_HELD'},exporterHealth:{lastError:'RXO_AUTH_NAVIGATION_REVIEW'}};
    c.refreshControl=()=>refreshes++;
    read=()=>c.control;
    setStatus=value=>{c.control=value;};
  } else {
    const store={status,refresh:()=>refreshes++};
    c=new RxoExpediteControlCenterComponent(store,auth,api,toast);
    read=()=>store.status;
    setStatus=value=>{store.status=value;};
  }
  return {c,action,errors,read,setStatus,get requests(){return requests;},get refreshes(){return refreshes;},setAdmin:value=>{admin=value;}};
}
let passed=0;
function test(name,fn){fn();passed++;console.log(`[PASS] ${name}`);}
for(const kind of ['standard','expedite']) {
  test(`${kind}: held navigation failure exposes recovery and preserves last verified status`,()=>{
    const f=fixture(kind),before=f.read();
    assert.equal(f.c.connectionRecoveryNeeded,true);assert.equal(f.c.recoveryAvailable,true);
    f.c.recoverConnection();f.c.recoverConnection();
    assert.equal(f.requests,1);assert.equal(f.c.recoveryBusy,true);assert.equal(f.read(),before);
    f.action.next({status:'QUEUED',message:'queued'});f.action.complete();
    assert.equal(f.c.recoveryBusy,false);assert.equal(f.refreshes,1);assert.equal(f.read(),before);
    assert.match(f.c.recoveryMessage,/Recovery requested/);assert.match(f.c.recoveryMessage,/Wait for a successful verified export/);
  });
  test(`${kind}: operator cannot invoke the administrator recovery action`,()=>{
    const f=fixture(kind);f.setAdmin(false);f.c.recoverConnection();assert.equal(f.requests,0);assert.equal(f.errors.length,1);
  });
  test(`${kind}: missing credentials route to Settings & Login without attempting login`,()=>{
    const f=fixture(kind);f.read().recovery={...metadata(),available:false,requiresCredentials:true};
    f.c.recoverConnection();assert.equal(f.requests,0);assert.equal(f.c.activeTab,'settings');assert.equal(f.c.recoveryAvailable,false);
  });
  test(`${kind}: MFA denial opens Settings & Login and a new corrected status clears the local block`,()=>{
    const f=fixture(kind);f.c.recoverConnection();
    f.action.error({status:409,error:{message:'Raw upstream exception: password=must-not-echo',requiresInteractiveLogin:true}});
    assert.equal(f.c.activeTab,'settings');assert.equal(f.c.recoveryBusy,false);assert.equal(f.c.recoveryLoginRequired,true);
    assert.match(f.c.recoveryError,/approval or an interactive sign-in/);assert.doesNotMatch(f.c.recoveryError,/must-not-echo/);assert.equal(f.refreshes,1);
    f.setStatus({...f.read(),recovery:metadata()});assert.equal(f.c.recoveryLoginRequired,false);
  });
  test(`${kind}: rejected credentials return safe instructions instead of raw exception text`,()=>{
    const f=fixture(kind);f.c.recoverConnection();
    f.action.error({status:409,error:{message:'https://provider.invalid/login?password=must-not-echo',requiresCredentials:true}});
    assert.equal(f.c.activeTab,'settings');assert.match(f.c.recoveryError,/credentials under Settings & Login/);assert.doesNotMatch(f.c.recoveryError,/provider|must-not-echo/);
  });
  test(`${kind}: cooldown keeps the action visible but blocked`,()=>{
    const f=fixture(kind);f.read().recovery={...metadata(),reason:null,available:false,cooldownUntil:new Date(Date.now()+60000).toISOString()};
    assert.equal(f.c.connectionRecoveryNeeded,true);assert.equal(f.c.recoveryCooldownActive,true);assert.equal(f.c.recoveryAvailable,false);
    f.c.recoverConnection();assert.equal(f.requests,0);
  });
  test(`${kind}: an already-running response never claims authentication has been fixed`,()=>{
    const f=fixture(kind);f.c.recoverConnection();f.action.next({status:'ALREADY_RUNNING',message:'already active'});f.action.complete();
    assert.match(f.c.recoveryMessage,/already queued or running/);assert.match(f.c.recoveryMessage,/not yet confirmed/);
  });
  test(`${kind}: unverified responses and network errors cannot produce success feedback`,()=>{
    const f=fixture(kind);f.c.recoverConnection();f.action.next({status:'OK'});f.action.complete();
    assert.equal(f.c.recoveryMessage,'');assert.match(f.c.recoveryError,/could not be confirmed/);
    const g=fixture(kind);g.c.recoverConnection();g.action.error({status:0,error:{message:'internal stack must-not-echo'}});
    assert.equal(g.c.recoveryBusy,false);assert.equal(g.c.recoveryMessage,'');assert.match(g.c.recoveryError,/not confirmed/);assert.doesNotMatch(g.c.recoveryError,/stack|must-not-echo/);assert.equal(g.refreshes,1);
  });
  test(`${kind}: active scans and unavailable recovery do not start a second attempt`,()=>{
    const f=fixture(kind);
    if(kind==='standard')f.c.view.scanRunning=true;else f.read().scheduler.state='EXPORTING';
    f.c.recoverConnection();assert.equal(f.requests,0);
    const g=fixture(kind);g.read().recovery.available=false;g.c.recoverConnection();assert.equal(g.requests,0);
  });
  test(`${kind}: stopped workers expose recovery without an auth error`,()=>{
    const f=fixture(kind);f.read().recovery.reason=null;
    if(kind==='standard'){f.c.view.scanNeedsReview=false;f.read().scheduler={status:'STOPPED'};f.read().exporterHealth={};}
    else{f.read().scheduler={state:'STOPPED'};f.read().acquisition={lastError:null};}
    assert.equal(f.c.connectionRecoveryNeeded,true);
  });
  test(`${kind}: healthy READY metadata does not create a false connection warning`,()=>{
    const f=fixture(kind);f.read().recovery={...metadata(),reason:'READY'};
    if(kind==='standard'){f.c.view.scanNeedsReview=false;f.read().scheduler={status:'WAITING',currentPhase:'IDLE'};f.read().exporterHealth={};}
    else{f.read().scheduler={state:'WAITING'};f.read().acquisition={lastError:null};}
    assert.equal(f.c.connectionRecoveryNeeded,false);
  });
  test(`${kind}: leaving the page cancels pending recovery feedback`,()=>{
    const f=fixture(kind);f.c.recoverConnection();f.c.ngOnDestroy();
    f.action.next({status:'QUEUED'});f.action.complete();assert.equal(f.c.recoveryMessage,'');assert.equal(f.refreshes,0);
  });
}
test('Recovery API methods post only to their own same-origin administrator endpoints',()=>{
  const posted=[];
  const api=new TruckLogApi({post:(url,body)=>{posted.push({url,body});return rxjs.of({status:'QUEUED'});}});
  api.recoverRxoConnection().subscribe();api.recoverRxoExpediteConnection().subscribe();
  assert.equal(posted[0].url,'/api/v1/rxo/control/recover');assert.equal(posted[1].url,'/api/v1/rxo/expedite/recover');
  assert.equal(Object.keys(posted[0].body).length,0);assert.equal(Object.keys(posted[1].body).length,0);
});
for(const file of [standardFile.replace('.ts','.html'),expediteFile]) {
  const source=fs.readFileSync(file,'utf8');
  assert.match(source,/\*ngIf="adminAuth\.canWrite\(\); else recoveryAdminSignIn"/);
  assert.match(source,/\[attr\.aria-busy\]="recoveryBusy"/);
  assert.match(source,/role="alert" \*ngIf="recoveryError"/);
  assert.match(source,/role="status" \*ngIf="recoveryMessage"/);
  assert.match(source,/MFA, approval or an interactive sign-in/);
}
console.log(`[PASS] RXO connection recovery UI: ${passed} behavioral regressions plus administrator/accessibility bindings.`);
