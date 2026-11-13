/** RXO authentication: bounded sign-in, verified app routes, and a durable no-retry gate.
 * No export, credential write, MFA handling, screenshot, HAR, or session-token output.
 * Single source for both RXO worker images: each Dockerfile copies libs/truck-log/rxo-shared/
 * into its own src/lib/, so the two images and data volumes stay independent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import { acquireLock, LockBusyError } from './process-lock.mjs';

export const AUTH_VERSION = '1';
export const AUTH_POLICY_VERSION = '1';
const HOLD = 'rxo-auth-review.json';
const LAST = 'rxo-auth-last.json';
const RETRY = 'rxo-auth-retry.json';
const BINDING = 'rxo-auth-session.json';
const RECOVERY = 'rxo-connection-recovery.json';
const RECOVERY_COOLDOWN_MS = 60_000;
const RECOVERY_WINDOW_MS = 60 * 60_000;
const RECOVERY_MAX_ATTEMPTS = 3;
const RETRY_TTL_MS = 30 * 60_000;
const CODES = new Set(['RXO_AUTH_FORM_NOT_READY','RXO_AUTH_FORM_AMBIGUOUS',
  'RXO_AUTH_APP_NOT_READY','RXO_AUTH_ACCOUNT_REVIEW','RXO_AUTH_REJECTED',
  'RXO_AUTH_VERIFICATION_REQUIRED','RXO_AUTH_ACCESS_REVIEW','RXO_AUTH_ORIGIN_REVIEW',
  'RXO_AUTH_INPUT_NOT_RETAINED','RXO_AUTH_PASSWORD_STEP_NOT_READY',
  'RXO_AUTH_SUBMISSION_UNCONFIRMED','RXO_AUTH_NAVIGATION_REVIEW',
  'RXO_AUTH_STATE_REVIEW','RXO_AUTH_CREDENTIALS_CHANGED','RXO_AUTH_SESSION_REVIEW']);
const roles = new Set(['standard','expedite']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export class RxoAuthError extends Error {
  constructor(code, detail = '') {
    super(`${CODES.has(code) ? code : 'RXO_AUTH_STATE_REVIEW'}${detail ? ': ' + detail : ''}`);
    this.name = 'RxoAuthError';
    this.code = CODES.has(code) ? code : 'RXO_AUTH_STATE_REVIEW';
    this.rxoAuthFailure = true;
  }
}
function fail(code) { throw new RxoAuthError(code); }
function dir(root) {
  const s = fs.lstatSync(root);
  if (!s.isDirectory() || s.isSymbolicLink()) fail('RXO_AUTH_STATE_REVIEW');
}
function read(root, name) {
  dir(root); const p = path.join(root, name); let s;
  try { s = fs.lstatSync(p); } catch(e) { if(e.code === 'ENOENT') return null; throw e; }
  if (!s.isFile() || s.isSymbolicLink() || s.size > 16384) fail('RXO_AUTH_STATE_REVIEW');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { fail('RXO_AUTH_STATE_REVIEW'); }
}
function write(root, name, value) {
  dir(root); read(root, name); // Refuse malformed or symlinked existing control files.
  const p = path.join(root,name), temp = p+'.'+randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    fs.renameSync(temp,p);
  } finally { try { fs.unlinkSync(temp); } catch(e) { if(e.code!=='ENOENT') throw e; } }
}
function remove(root,name) { if(read(root,name)!==null) fs.unlinkSync(path.join(root,name)); }
function validRecord(v,role) {
  const credentialVersionOk = v?.credentialVersion === undefined ||
    (typeof v.credentialVersion === 'string' && v.credentialVersion.length >= 3 && v.credentialVersion.length <= 512);
  const notificationOk = v?.notification === undefined || (v.notification &&
    ['NOT_REQUIRED','DISABLED','SENDING','SENT','FAILED','RECIPIENT_REVIEW','CONFIG_REVIEW'].includes(v.notification.status) &&
    (v.notification.at === null || (typeof v.notification.at === 'string' && Number.isFinite(Date.parse(v.notification.at)))));
  return v && v.version===AUTH_VERSION && v.role===role && CODES.has(v.code) &&
    ['BEFORE_SUBMIT','FAILED'].includes(v.phase) && [0,1].includes(v.passwordSubmissions) &&
    typeof v.updatedAt==='string' && Number.isFinite(Date.parse(v.updatedAt)) &&
    typeof v.message==='string' && v.message.length<=600 && credentialVersionOk && notificationOk;
}
export function readAuthHold(root,role) {
  if(!roles.has(role)) fail('RXO_AUTH_STATE_REVIEW');
  const v=read(root,HOLD); if(v===null) return null;
  if(!validRecord(v,role)) fail('RXO_AUTH_STATE_REVIEW');
  return v;
}
export function assertAuthMayRun(root,role) {
  const h=readAuthHold(root,role);
  if(h) throw new RxoAuthError(h.code,'Automatic sign-in is paused. Review the last sign-in result before requesting one retry.');
}
const HARD_CREDENTIAL_CODES = new Set(['RXO_AUTH_REJECTED','RXO_AUTH_ACCOUNT_REVIEW']);
// A credential VERSION identifies the credential CONTENTS, never the file identity:
// saves rewrite files (new inode/mtime) and Expedite saves always create a new
// generation, so re-saving an unchanged, already-rejected password must not
// count as a change. The digest is an HMAC under a random per-install key kept
// next to the auth state, so the hold records never carry a bare password hash.
const KEY='rxo-auth-credential-key';
function credentialKey(root,create=true) {
  dir(root); const p=path.join(root,KEY);
  const load=()=>{const s=fs.lstatSync(p);
    if(!s.isFile()||s.isSymbolicLink()||s.size!==65)fail('RXO_AUTH_STATE_REVIEW');
    const hex=fs.readFileSync(p,'utf8').trim(); if(!/^[a-f0-9]{64}$/.test(hex))fail('RXO_AUTH_STATE_REVIEW');
    return Buffer.from(hex,'hex');};
  try { return load(); } catch(e) { if(e?.code!=='ENOENT')throw e; }
  if(!create)return null;
  const temp=p+'.'+randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temp,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
    try { fs.linkSync(temp,p); } catch(e) { if(e?.code!=='EEXIST')throw e; } // first writer wins
  } finally { try { fs.unlinkSync(temp); } catch {} }
  return load();
}
function secretText(file,max) {
  let st; try { st=fs.lstatSync(file); } catch { fail('RXO_AUTH_STATE_REVIEW'); }
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>max)fail('RXO_AUTH_STATE_REVIEW');
  return fs.readFileSync(file,'utf8').trim();
}
function currentCredentials(role,secretRoot) {
  if(role==='standard') {
    const user=process.env.RXO_USERNAME_FILE||path.join(secretRoot,'rxo_username');
    const pass=process.env.RXO_PASSWORD_FILE||path.join(secretRoot,'rxo_password');
    return [secretText(user,4096),secretText(pass,16384)];
  }
  const pointer=read(secretRoot,'rxo_expedite_current.json');
  if(pointer?.contractVersion!==1||!/^[a-f0-9-]{36}$/.test(pointer.generation||''))fail('RXO_AUTH_STATE_REVIEW');
  const generation=path.join(secretRoot,'rxo_expedite_versions',pointer.generation);
  return [secretText(path.join(generation,'rxo_expedite_username'),1024),
    fs.readFileSync(path.join(generation,'rxo_expedite_password'),'utf8')];
}
export function currentCredentialVersion(role,keyRoot,secretRoot=process.env.RXO_SECRET_ROOT||'/run/secrets',createKey=true) {
  if(!roles.has(role)||typeof keyRoot!=='string')fail('RXO_AUTH_STATE_REVIEW');
  const [username,password]=currentCredentials(role,secretRoot);
  const key=credentialKey(keyRoot,createKey); if(!key)return null;
  const digest=createHmac('sha256',key).update(JSON.stringify([role,username,password])).digest('hex');
  return role+':hmac-sha256:'+digest;
}
function bindLegacyHold(root,role,hold) {
  if(hold?.credentialVersion)return hold;
  const bound={...hold,credentialVersion:currentCredentialVersion(role,root),updatedAt:new Date().toISOString()};
  write(root,HOLD,bound); return bound;
}
function holdCredentialsChanged(root,role,hold) {
  const current=currentCredentialVersion(role,root,process.env.RXO_SECRET_ROOT||'/run/secrets',false);
  if(!current)fail('RXO_AUTH_STATE_REVIEW');
  return hold.credentialVersion!==current;
}
export function credentialsChangedSinceHold(root,role) {
  let hold=readAuthHold(root,role); if(!hold)return false;
  hold=bindLegacyHold(root,role,hold);
  return holdCredentialsChanged(root,role,hold);
}
function recoveryUpdateLock(root,operation) {
  dir(root);
  const lock=acquireLock(path.join(root,'.rxo-connection-recovery.lock'),{
    staleAfterMs:30_000,maxHoldMs:30_000,purpose:'RXO connection recovery',log:()=>{},
  });
  try{return operation();}finally{lock.release();}
}
async function recoveryOperation(root,operation) {
  for(let attempt=0;attempt<40;attempt++) {
    try{return recoveryUpdateLock(root,operation);}catch(error){
      if(!(error instanceof LockBusyError)||attempt===39)throw error;
      await pause(25);
    }
  }
}
function recoveryRecord(root,role) {
  const r=read(root,RECOVERY); if(!r)return null;
  const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=Date.now()+60_000;
  if(r.version!==AUTH_VERSION||r.role!==role||!/^[-a-f0-9]{36}$/.test(r.id||'')||
    !['QUEUED','RUNNING','AUTHENTICATED','FAILED'].includes(r.phase)||typeof r.refreshSession!=='boolean'||
    !date(r.requestedAt)||!date(r.updatedAt)||(r.deliveryRequestedAt!==undefined&&!date(r.deliveryRequestedAt))||
    !Array.isArray(r.attempts)||!r.attempts.length||r.attempts.length>RECOVERY_MAX_ATTEMPTS||!r.attempts.every(date))fail('RXO_AUTH_STATE_REVIEW');
  return r;
}
function retryRecord(root,role) {
  const r=read(root,RETRY);if(!r)return null;
  if(r.version!==AUTH_VERSION||r.role!==role||!/^[-a-f0-9]{36}$/.test(r.id||'')||
    typeof r.requestedAt!=='string'||!Number.isFinite(Date.parse(r.requestedAt))||
    (r.kind!==undefined&&r.kind!=='connection'))fail('RXO_AUTH_STATE_REVIEW');
  return r;
}
function retryFresh(r) {const age=Date.now()-Date.parse(r.requestedAt);return age>=-60_000&&age<=RETRY_TTL_MS;}
function matchingQueue(r,recovery) {
  if(!r||r.kind!=='connection')return false;
  if(!recovery||recovery.id!==r.id||recovery.phase!=='QUEUED')fail('RXO_AUTH_STATE_REVIEW');
  return retryFresh(r);
}
function recoveryInfo(available,reason,message,extra={}) {
  return {available,reason,message,requiresCredentials:false,requiresInteractiveLogin:false,cooldownUntil:null,...extra};
}
function blockedHold(hold,changed) {
  if(!hold||changed)return null;
  if(HARD_CREDENTIAL_CODES.has(hold.code))return recoveryInfo(false,'CREDENTIALS_UNCHANGED',
    'RXO rejected or locked this sign-in. Update the credentials in Settings & Login first.',{requiresCredentials:true});
  if(['RXO_AUTH_VERIFICATION_REQUIRED','RXO_AUTH_ACCESS_REVIEW','RXO_AUTH_ORIGIN_REVIEW'].includes(hold.code))return recoveryInfo(false,'INTERACTIVE_LOGIN_REQUIRED',
    'RXO requires a verification, sign-in or access review. Open Settings & Login for the next step.',{requiresInteractiveLogin:true});
  if(hold.code==='RXO_AUTH_STATE_REVIEW')return recoveryInfo(false,'STATE_REVIEW','RXO sign-in state requires operator review before recovery.');
  return null;
}
/** Read-only even on a fresh installation: never create a lock or HMAC key. */
export function connectionRecoveryStatus(root,role) {
  if(!roles.has(role))fail('RXO_AUTH_STATE_REVIEW');
  try {
    const hold=readAuthHold(root,role), recovery=recoveryRecord(root,role), retry=retryRecord(root,role);
    const pending=matchingQueue(retry,recovery);
    try {const [user,password]=currentCredentials(role,process.env.RXO_SECRET_ROOT||'/run/secrets');if(!user||!password)throw Error();}
    catch{return recoveryInfo(false,'CREDENTIALS_MISSING','Save the RXO sign-in details in Settings & Login first.',{requiresCredentials:true});}
    const current=hold?.credentialVersion?currentCredentialVersion(role,root,process.env.RXO_SECRET_ROOT||'/run/secrets',false):null;
    if(hold?.credentialVersion&&!current)return recoveryInfo(false,'STATE_REVIEW','The RXO credential-version key is missing. Sign-in state requires operator review.');
    const blocked=blockedHold(hold,!!current&&hold.credentialVersion!==current); if(blocked)return blocked;
    const now=Date.now(), requestedAt=recovery?.requestedAt;
    const deliveryAt=recovery?.deliveryRequestedAt||requestedAt;
    const cooldownUntil=deliveryAt?new Date(Date.parse(deliveryAt)+RECOVERY_COOLDOWN_MS).toISOString():null;
    if(cooldownUntil&&Date.parse(cooldownUntil)>now)return recoveryInfo(false,'COOLDOWN',
      'A recovery was already requested. Wait one minute before requesting another.',{cooldownUntil,requestedAt});
    const attempts=(recovery?.attempts||[]).filter(at=>now-Date.parse(at)<RECOVERY_WINDOW_MS);
    if(attempts.length>=RECOVERY_MAX_ATTEMPTS&&!pending)return recoveryInfo(false,'RETRY_LIMIT',
      'Three recovery attempts were requested in the last hour. Check Settings & Login or wait for the limit to reset.',
      {cooldownUntil:new Date(Math.min(...attempts.map(Date.parse))+RECOVERY_WINDOW_MS).toISOString(),requestedAt});
    return recoveryInfo(true,null,'Refresh the RXO session and request one verified scan. The last verified data stays available.',requestedAt?{requestedAt}:{});
  } catch(error) {
    if(error instanceof RxoAuthError||['ENOENT','EACCES','EROFS'].includes(error?.code))return recoveryInfo(false,'STATE_REVIEW','RXO sign-in state requires operator review before recovery.');
    throw error;
  }
}
export function requestConnectionRecovery(root,role) {
  if(!roles.has(role))fail('RXO_AUTH_STATE_REVIEW');
  try {return recoveryUpdateLock(root,()=>queueConnectionRecoveryLocked(root,role));}catch(error){
    if(error instanceof LockBusyError)return {role,requested:false,reason:'COOLDOWN',message:'Another recovery request is being processed. Refresh status shortly.'};
    throw error;
  }
}
/**
 * Holds an administrator may clear after checking RXO themselves: a verification or access step
 * that was completed outside Truck Log, or a sign-in page that briefly showed an unexpected host
 * (an RXO error page, a blank tab). Credentials are never entered on an unapproved host, so one
 * more attempt is safe; if the cause remains, the attempt stops at the same check and holds again.
 * Rejected or locked credentials are NOT clearable here: retrying them unchanged can lock the account.
 */
const ACKNOWLEDGEABLE_HOLD_CODES=new Set(['RXO_AUTH_VERIFICATION_REQUIRED','RXO_AUTH_ACCESS_REVIEW','RXO_AUTH_ORIGIN_REVIEW']);
export function acknowledgeAuthHold(root,role) {
  if(!roles.has(role))fail('RXO_AUTH_STATE_REVIEW');
  try {return recoveryUpdateLock(root,()=>{
    const hold=readAuthHold(root,role);
    if(hold&&!ACKNOWLEDGEABLE_HOLD_CODES.has(hold.code)){
      const blocked=blockedHold(hold,false)||recoveryInfo(false,'STATE_REVIEW','RXO sign-in state requires operator review before recovery.');
      return {role,requested:false,...blocked};
    }
    if(hold)releaseAuthHold(root,role);
    // The usual cooldown and hourly limit still apply: if no recovery can be queued now, the hold
    // goes back unchanged, so acknowledging can never bypass those limits.
    const queued=queueConnectionRecoveryLocked(root,role);
    if(!queued.requested&&hold)write(root,HOLD,hold);
    return {...queued,holdCleared:!!hold&&queued.requested};
  });}catch(error){
    if(error instanceof LockBusyError)return {role,requested:false,reason:'COOLDOWN',message:'Another recovery request is being processed. Refresh status shortly.'};
    throw error;
  }
}
function queueConnectionRecoveryLocked(root,role) {
    const status=connectionRecoveryStatus(root,role);if(!status.available)return {role,requested:false,...status};
    const prior=recoveryRecord(root,role), retry=retryRecord(root,role), now=Date.now(), at=new Date(now).toISOString();
    if(matchingQueue(retry,prior)) {
      write(root,RECOVERY,{...prior,deliveryRequestedAt:at,updatedAt:at});
      return {role,requested:true,reason:'ALREADY_QUEUED',requestedAt:prior.requestedAt,
        cooldownUntil:new Date(now+RECOVERY_COOLDOWN_MS).toISOString(),message:'The existing recovery request is queued for the scheduler.'};
    }
    const id=randomUUID(),attempts=[...(prior?.attempts||[]).filter(t=>now-Date.parse(t)<RECOVERY_WINDOW_MS),at];
    write(root,RECOVERY,{version:AUTH_VERSION,role,id,phase:'QUEUED',attempts,requestedAt:at,deliveryRequestedAt:at,updatedAt:at,refreshSession:false});
    write(root,RETRY,{version:AUTH_VERSION,role,id,requestedAt:at,kind:'connection'});
    return {role,requested:true,requestedAt:at,cooldownUntil:new Date(now+RECOVERY_COOLDOWN_MS).toISOString(),
      message:'Recovery queued. Wait for a verified RXO export before treating the connection as restored.'};
}
function startQueuedRecovery(root,role,retry,recovery) {
  matchingQueue(retry,recovery);
  let hold=readAuthHold(root,role), changed=false;
  if(hold){hold=bindLegacyHold(root,role,hold);changed=holdCredentialsChanged(root,role,hold);}
  const blocked=blockedHold(hold,changed);
  remove(root,RETRY);
  write(root,RECOVERY,{...recovery,phase:blocked?'FAILED':'RUNNING',refreshSession:!blocked,updatedAt:new Date(Date.now()).toISOString()});
  if(blocked)return false;
  releaseAuthHold(root,role); return true;
}
function authorizeManualRetryLocked(root,role) {
  const recovery=recoveryRecord(root,role), retry=retryRecord(root,role);
  if(retry?.kind==='connection')return consumeAuthRetryLocked(root,role,retry,recovery);
  let hold=readAuthHold(root,role);if(!hold)return true;
  hold=bindLegacyHold(root,role,hold);
  const changed=holdCredentialsChanged(root,role,hold);
  if(blockedHold(hold,changed))return false;
  if(changed){releaseAuthHold(root,role);if(retry)remove(root,RETRY);return true;}
  const status=connectionRecoveryStatus(root,role);if(!status.available)return false;
  const now=Date.now(),at=new Date(now).toISOString();
  write(root,RECOVERY,{version:AUTH_VERSION,role,id:randomUUID(),phase:'RUNNING',refreshSession:true,requestedAt:at,deliveryRequestedAt:at,updatedAt:at,
    attempts:[...(recovery?.attempts||[]).filter(t=>now-Date.parse(t)<RECOVERY_WINDOW_MS),at]});
  releaseAuthHold(root,role);if(retry)remove(root,RETRY);return true;
}
export function authorizeManualRetry(root,role) {
  if(!roles.has(role))fail('RXO_AUTH_STATE_REVIEW');
  try{return recoveryUpdateLock(root,()=>authorizeManualRetryLocked(root,role));}
  catch(error){if(error instanceof LockBusyError)return false;throw error;}
}
export function consumeCredentialChangeRetry(root,role) {
  if(!roles.has(role))fail('RXO_AUTH_STATE_REVIEW');
  try{return recoveryUpdateLock(root,()=>{
    if(!credentialsChangedSinceHold(root,role))return false;
    const retry=retryRecord(root,role);
    if(retry?.kind==='connection')return consumeAuthRetryLocked(root,role,retry,recoveryRecord(root,role));
    releaseAuthHold(root,role);if(retry)remove(root,RETRY);return true;
  });}catch(error){if(error instanceof LockBusyError)return false;throw error;}
}
export function requestAuthRetry(root,role) {
  if(!readAuthHold(root,role))return {role,requested:false,reason:'NO_AUTH_HOLD'};
  const result=requestConnectionRecovery(root,role);
  // Retain the operator CLI's legacy response shape; webpage controls use the
  // richer requestConnectionRecovery metadata directly.
  return {role,requested:result.requested,...(result.reason?{reason:result.reason}:{})};
}
function consumeAuthRetryLocked(root,role,retry=retryRecord(root,role),recovery=recoveryRecord(root,role)) {
  if(!retry)return false;
  if(retry.kind==='connection') {
    const fresh=matchingQueue(retry,recovery);
    if(!fresh){remove(root,RETRY);write(root,RECOVERY,{...recovery,phase:'FAILED',refreshSession:false,updatedAt:new Date(Date.now()).toISOString()});return false;}
    return startQueuedRecovery(root,role,retry,recovery);
  }
  remove(root,RETRY);if(!retryFresh(retry))return false;
  return authorizeManualRetryLocked(root,role);
}
export function consumeAuthRetry(root,role) {
  if(!roles.has(role))fail('RXO_AUTH_STATE_REVIEW');
  try{return recoveryUpdateLock(root,()=>consumeAuthRetryLocked(root,role));}
  catch(error){if(error instanceof LockBusyError)return false;throw error;}
}
/** A queued handoff may still be waiting for its short metadata lock. */
export function hasPendingAuthRetry(root,role) {
  if(!roles.has(role))fail('RXO_AUTH_STATE_REVIEW');
  return !!retryRecord(root,role)||recoveryRecord(root,role)?.phase==='QUEUED';
}
async function consumeSessionRefresh(root,role,expectedId) {
  if(!expectedId)return false;
  return recoveryOperation(root,()=>{
    const r=recoveryRecord(root,role);
    if(!r||r.id!==expectedId||r.phase!=='RUNNING'||!r.refreshSession)return false;
    write(root,RECOVERY,{...r,refreshSession:false,updatedAt:new Date(Date.now()).toISOString()});return true;
  });
}
async function completeRecovery(root,role,expectedId,phase) {
  if(!expectedId)return false;
  try{return await recoveryOperation(root,()=>{
    const r=recoveryRecord(root,role);
    if(!r||r.id!==expectedId||r.phase!=='RUNNING')return false;
    if(!['AUTHENTICATED','FAILED'].includes(phase))fail('RXO_AUTH_STATE_REVIEW');
    write(root,RECOVERY,{...r,phase,refreshSession:false,updatedAt:new Date(Date.now()).toISOString()});return true;
  });}catch(error){if(error instanceof LockBusyError)return false;throw error;}
}
export function releaseAuthHold(root,role) {
  if(readAuthHold(root,role)) remove(root,HOLD);
}

const NOTIFY_CODES = new Set(['RXO_AUTH_REJECTED','RXO_AUTH_ACCOUNT_REVIEW']);
function emailAddress(value) {
  const raw=String(value||'').trim();
  const angle=raw.match(/<([^<>]+)>\s*$/); const address=(angle?angle[1]:raw).trim();
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address)?address:null;
}
function smtpConfig() {
  const enabled=/^(1|true|yes)$/i.test(process.env.TRUCK_LOG_RXO_AUTH_EMAIL_ENABLED||'false');
  if(!enabled)return {enabled:false};
  const host=String(process.env.SMTP_HOST||'').trim();
  const port=Number(process.env.SMTP_PORT||25);
  const fromRaw=String(process.env.SMTP_FROM||'').trim(); const from=emailAddress(fromRaw);
  if(!host||host.length>253||/[\s\x00-\x1f\x7f]/.test(host)||!Number.isInteger(port)||port<1||port>65535||!from)
    return {enabled:true,valid:false};
  return {enabled:true,valid:true,host,port,from,fromRaw};
}
function smtpSafeLine(value) { return String(value||'').replace(/[\r\n\x00-\x1f\x7f]/g,' ').trim().slice(0,998); }
async function smtpSend({host,port,from,fromRaw,to,subject,text}) {
  const timeout=15000;
  let socket; let buffer=''; const waiting=[];
  const rejectPending=e=>{while(waiting.length)waiting.shift().reject(e);};
  const attach=(sock)=>{ socket=sock; socket.setTimeout(timeout);
    socket.on('timeout',()=>socket.destroy(new Error('SMTP_TIMEOUT')));
    socket.on('error',rejectPending); socket.on('close',()=>rejectPending(new Error('SMTP_CLOSED')));
    socket.on('data',chunk=>{ buffer+=chunk.toString('utf8'); if(buffer.length>65536){socket.destroy(new Error('SMTP_RESPONSE_LIMIT'));return;} pump(); }); };
  const pump=()=>{ while(waiting.length){ const lines=buffer.split(/\r?\n/); if(lines.length<2)return; let used=0, code=null, done=false, response=[];
      for(let i=0;i<lines.length-1;i++){ const line=lines[i]; response.push(line); used+=Buffer.byteLength(line,'utf8')+(buffer.includes('\r\n')?2:1); const m=line.match(/^(\d{3})([ -])/); if(m){code=Number(m[1]); if(m[2]===' '){done=true;break;}} }
      if(!done)return; buffer=buffer.slice(used); const w=waiting.shift(); w.resolve({code,text:response.join('\n')}); }};
  const response=()=>new Promise((resolve,reject)=>{waiting.push({resolve,reject});pump();});
  const command=async(line,expected)=>{socket.write(line+'\r\n');const r=await response();if(!expected.includes(r.code))throw Error('SMTP_PROTOCOL');return r;};
  const connect=()=>new Promise((resolve,reject)=>{ const opts={host,port,timeout}; const sock=port===465?tls.connect({...opts,servername:net.isIP(host)?undefined:host,rejectUnauthorized:true},()=>resolve(sock)):net.connect(opts,()=>resolve(sock)); sock.once('error',reject); sock.once('timeout',()=>sock.destroy(new Error('SMTP_TIMEOUT'))); });
  try {
    let sock=await connect(); attach(sock); const greet=await response(); if(greet.code!==220)throw Error('SMTP_GREETING');
    let ehlo=await command('EHLO truck-log',[250]);
    if(port!==465&&/(^|\n)250[- ]STARTTLS(?:\s|$)/i.test(ehlo.text)) {
      await command('STARTTLS',[220]);
      const plain=socket; plain.removeAllListeners('data'); plain.removeAllListeners('error'); plain.removeAllListeners('close'); plain.removeAllListeners('timeout');
      sock=await new Promise((resolve,reject)=>{const secure=tls.connect({socket:plain,servername:net.isIP(host)?undefined:host,rejectUnauthorized:true},()=>resolve(secure));secure.once('error',reject);});
      buffer=''; attach(sock); ehlo=await command('EHLO truck-log',[250]);
    }
    await command('MAIL FROM:<'+from+'>',[250]); await command('RCPT TO:<'+to+'>',[250,251]); await command('DATA',[354]);
    const headers=['From: '+smtpSafeLine(fromRaw),'To: '+smtpSafeLine(to),'Subject: '+smtpSafeLine(subject),'Date: '+new Date().toUTCString(),'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit'];
    const body=String(text||'').replace(/\r?\n/g,'\r\n').replace(/^\./gm,'..'); socket.write(headers.join('\r\n')+'\r\n\r\n'+body+'\r\n.\r\n');
    const accepted=await response(); if(accepted.code!==250)throw Error('SMTP_NOT_ACCEPTED');
    try{await command('QUIT',[221,250]);}catch{}
  } finally { if(socket&&!socket.destroyed)socket.destroy(); }
}
async function updateNotification(root,role,status) {
  const hold=readAuthHold(root,role); if(!hold)return;
  write(root,HOLD,{...hold,notification:{status,at:new Date().toISOString()},updatedAt:new Date().toISOString()});
}
// A process killed mid-send leaves SENDING behind; after this long it is retried once more.
const SENDING_RETRY_AFTER_MS=10*60*1000;
export function notificationPending(notification,now=Date.now()) {
  const status=notification?.status;
  if(['SENT','FAILED','RECIPIENT_REVIEW'].includes(status))return false;
  if(status==='SENDING')return !(now-Date.parse(notification.at)<SENDING_RETRY_AFTER_MS);
  return true;
}
async function notifyCredentialFailure(root,role,code,username) {
  if(!NOTIFY_CODES.has(code))return;
  const hold=readAuthHold(root,role);
  if(!notificationPending(hold?.notification))return; // one delivery attempt per held credential version
  const cfg=smtpConfig();
  if(!cfg.enabled)return; // Enabling mail later may still notify this held failure.
  if(!cfg.valid){await updateNotification(root,role,'CONFIG_REVIEW');return;}
  const to=emailAddress(username); if(!to){await updateNotification(root,role,'RECIPIENT_REVIEW');return;}
  const site=role==='standard'?'Standard RXO':'RXO Expedite';
  const locked=code==='RXO_AUTH_ACCOUNT_REVIEW';
  const subject=locked?`Truck Log: ${site} account needs attention`:`Truck Log: ${site} password was rejected`;
  const text=locked?
    `Truck Log stopped ${site} automatic scans after RXO reported an account lock or block.\n\nResolve the account issue with RXO, then save the working credentials in Truck Log. Truck Log will allow one verification attempt for the changed credentials and will resume scheduled scans only after successful authentication.\n\nNo password is included in this email.`:
    `Truck Log stopped ${site} automatic scans after the first explicit credential rejection.\n\nUpdate the RXO password in Truck Log Settings & Login. Truck Log will allow one verification attempt for the changed credentials and will resume scheduled scans only after successful authentication.\n\nNo additional automatic password attempts will occur while the rejected credential version is held.`;
  await updateNotification(root,role,'SENDING'); // reserve one mail attempt before network I/O
  try { await smtpSend({...cfg,to,subject,text}); await updateNotification(root,role,'SENT'); }
  catch { await updateNotification(root,role,'FAILED'); }
}
function credentialUsername(role,secretRoot=process.env.RXO_SECRET_ROOT||'/run/secrets') {
  if(role==='standard') {
    const p=process.env.RXO_USERNAME_FILE||path.join(secretRoot,'rxo_username');
    const st=fs.lstatSync(p); if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>4096)fail('RXO_AUTH_STATE_REVIEW');
    return fs.readFileSync(p,'utf8').trim();
  }
  const pointer=read(secretRoot,'rxo_expedite_current.json');
  if(pointer?.contractVersion!==1||!/^[a-f0-9-]{36}$/.test(pointer.generation||''))fail('RXO_AUTH_STATE_REVIEW');
  const p=path.join(secretRoot,'rxo_expedite_versions',pointer.generation,'rxo_expedite_username');
  const st=fs.lstatSync(p); if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>4096)fail('RXO_AUTH_STATE_REVIEW');
  return fs.readFileSync(p,'utf8').trim();
}
export async function ensureAuthFailureNotification(root,role) {
  const hold=readAuthHold(root,role); if(!hold||!NOTIFY_CODES.has(hold.code))return false;
  await notifyCredentialFailure(root,role,hold.code,credentialUsername(role));
  return readAuthHold(root,role)?.notification?.status==='SENT';
}

// Deliberately inspect only visible login validation messages; never page-body text.
export function redactLoginMessage(text,credentials={}) {
  let s=String(text||'');
  for(const v of [credentials.username,credentials.password]) if(typeof v==='string'&&v) {
    for(const variant of new Set([v,encodeURIComponent(v),Buffer.from(v).toString('base64')]))
      s=s.split(variant).join('[redacted]');
  }
  return s.replace(/((?:token|authorization|password|secret|code)\s*[:=]\s*)\S+/gi,'$1[redacted]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email]')
    .replace(/https?:\/\/\S+/gi,'[url]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[token]').replace(/\b[A-Za-z0-9_+\/=-]{32,}\b/g,'[identifier]')
    .replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,600);
}
export function classifyLoginMessage(text) {
  const s=String(text||'').replace(/\s+/g,' ').trim();
  // Conditional/help/negated wording is not an account-state assertion.
  if(/\bif\b|\bnot (?:locked|disabled|blocked)\b|\bnever (?:locked|disabled)\b/i.test(s)) return null;
  if(/(?:your |this |the )?account (?:[\w.+-]+@[\w.-]+ )?(?:is |has been |was |has become )?(?:temporarily |permanently )?(?:locked|disabled|blocked)|too many (?:failed )?(?:login|sign.in|authentication) attempts/i.test(s)) return 'RXO_AUTH_ACCOUNT_REVIEW';
  if(/(?:invalid|incorrect|wrong) (?:user\s*name|email|password|credentials)|(?:user\s*name|email|password|credentials).{0,60}(?:invalid|incorrect)|authentication failed|sign.in failed/i.test(s)) return 'RXO_AUTH_REJECTED';
  if(/verification code|one.time (?:code|password)|approve (?:the |this )?(?:sign.in|request)|authenticator|multi.factor|two.factor|change (?:your |the )?password|password (?:has )?expired/i.test(s)) return 'RXO_AUTH_VERIFICATION_REQUIRED';
  if(/access denied|verify (?:that )?you are human|captcha|unusual traffic|automated access|request (?:was )?blocked/i.test(s)) return 'RXO_AUTH_ACCESS_REVIEW';
  return null;
}
const ALERTS='[role="alert"],.validation-summary-errors,.field-validation-error,.alert-danger,.o-form-error-container,.error-message,[data-se="o-form-error-container"]';
function httpsUrl(raw) { try { const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password?u:null; }catch{return null;} }
export function standardPostLoginCandidate(raw) {
  const u=httpsUrl(raw); if(!u||u.origin!=='https://customer.rxoconnect.rxo.com')return false;
  const p=u.pathname.replace(/\/$/,'')||'/';
  // RXO's OIDC callback is an expected post-submit transition, not a login form.
  // Give the SPA time to finish processing it, then navigate to the known Orders route.
  if(p==='/signin-oidc')return true;
  return !/login|sign.?in|authorize/i.test(p);
}
export function allowedAuthUrl(raw,role) {
  const u=httpsUrl(raw); if(!u)return false;
  // No arbitrary external identity provider receives credentials. Add a new
  // origin only after inspecting an actual RXO-controlled redirect.
  if(role==='expedite')return u.origin==='https://www.expedite.rxo.com';
  return u.hostname==='rxo.com'||u.hostname.endsWith('.rxo.com');
}
function assertFrame(page,frame,role) {
  if(!allowedAuthUrl(page.url(),role)||!allowedAuthUrl(frame.url(),role)) {
    const host=httpsUrl(frame.url())?.hostname;
    throw new RxoAuthError('RXO_AUTH_ORIGIN_REVIEW',host?'Unapproved sign-in host: '+host:'Unapproved sign-in surface.');
  }
}
async function visibleAll(locator,editable=false) {
  const result=[]; const count=await locator.count().catch(()=>0);
  if(count>100)fail('RXO_AUTH_FORM_AMBIGUOUS');
  for(let i=0;i<count;i++) {
    const item=locator.nth(i);
    if(await item.isVisible().catch(()=>false) && (!editable || await item.isEditable().catch(()=>false)))result.push(item);
  }
  return result;
}
const USER='input[autocomplete="username"],input[type="email"],input[name*="user" i],input[id*="user" i],input[name*="email" i],input[id*="email" i],input[name="loginfmt"],input[placeholder*="email" i],input[placeholder*="user" i],input[aria-label*="email" i]';
const PASSWORD='input[type="password"]:not([autocomplete="new-password"])';
async function loginFields(page,role) {
  const pairs=[];
  for(const frame of page.frames()) {
    const users=(await visibleAll(frame.locator(USER).and(frame.locator('input:not([type="password"])')),true)).filter(Boolean);
    const passwords=await visibleAll(frame.locator(PASSWORD),true);
    if(!users.length&&!passwords.length)continue;
    assertFrame(page,frame,role);
    if(passwords.length>1)fail('RXO_AUTH_FORM_AMBIGUOUS');
    if(passwords.length===1) {
      const owner=passwords[0].locator('xpath=ancestor::form[1]');
      const scope=await owner.count()===1?owner:frame;
      const scopedUsers=await visibleAll(scope.locator(USER).and(scope.locator('input:not([type="password"])')),true);
      if(scopedUsers.length>1)fail('RXO_AUTH_FORM_AMBIGUOUS');
      pairs.push({frame,scope,user:scopedUsers[0]??null,password:passwords[0]});
    } else if(users.length===1)pairs.push({frame,scope:frame,user:users[0],password:null});
    else fail('RXO_AUTH_FORM_AMBIGUOUS');
  }
  if(pairs.length>1)fail('RXO_AUTH_FORM_AMBIGUOUS');
  return pairs[0]??null;
}
async function warning(page,role,credentials) {
  for(const frame of page.frames()) {
    if(!allowedAuthUrl(frame.url(),role))continue;
    const otp=await visibleAll(frame.locator('input[autocomplete="one-time-code"],input[name*="otp" i],input[id*="otp" i]'));
    if(otp.length)return {code:'RXO_AUTH_VERIFICATION_REQUIRED',message:'A one-time verification input is visible.'};
    const captcha=await visibleAll(frame.locator('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[title*="challenge" i]'));
    if(captcha.length)return {code:'RXO_AUTH_ACCESS_REVIEW',message:'An access-verification challenge is visible.'};
    for(const heading of await visibleAll(frame.locator('h1,h2,[role="heading"]'))) {
      const code=classifyLoginMessage(await heading.innerText({timeout:1000}).catch(()=>''));
      if(['RXO_AUTH_VERIFICATION_REQUIRED','RXO_AUTH_ACCESS_REVIEW'].includes(code))return {code,message:'Sign-in requires an additional verification or access step.'};
    }
    for(const a of await visibleAll(frame.locator(ALERTS))) {
      const text=await a.innerText({timeout:1000}).catch(()=>'');
      const code=classifyLoginMessage(text);
      if(code)return {code,message:redactLoginMessage(text,credentials)};
    }
  }
  return null;
}
async function throwWarning(page,role,credentials) {
  const w=await warning(page,role,credentials); if(w)throw new RxoAuthError(w.code,w.message);
}
async function uniqueButton(scope,pattern) {
  const buttons=scope.getByRole('button',{name:pattern}).or(scope.getByRole('link',{name:pattern}));
  const visible=await visibleAll(buttons);
  if(visible.length>1)fail('RXO_AUTH_FORM_AMBIGUOUS');
  return visible[0]??null;
}
async function appReady(page,role) {
  const u=httpsUrl(page.url()); if(!u)return false;
  if(role==='standard') {
    if(u.origin!=='https://customer.rxoconnect.rxo.com'||u.pathname.replace(/\/$/,'')!=='/orders/list')return false;
    for(const frame of page.frames())if((await visibleAll(frame.locator('input[type="password"]'))).length)return false;
    return (await visibleAll(page.getByText(/^Export$/i))).length>0;
  }
  if(u.origin!=='https://www.expedite.rxo.com'||!/^\/WebClient\/?$/i.test(u.pathname)||
    !/^#\/?freight-on-the-move(?:[/?]|$)/i.test(u.hash))return false;
  for(const frame of page.frames())if((await visibleAll(frame.locator('input[type="password"]'))).length)return false;
  return (await visibleAll(page.locator('button,a,[role="button"],[ng-click],[data-ng-click],[onclick],.btn,.k-button,label').filter({hasText:/^\s*list\s*$/i}))).length>0;
}
async function navigate(page,url,timeoutMs,role) {
  if(!allowedAuthUrl(url,role))fail('RXO_AUTH_ORIGIN_REVIEW');
  // Commit means the navigation reached a response. RXO/OIDC scripts can keep
  // DOMContentLoaded pending after a usable app or login surface already exists.
  // Callers still verify that actual surface; commit alone never proves login.
  try { await page.goto(url,{waitUntil:'commit',timeout:timeoutMs}); }
  catch(e) {
    if(!allowedAuthUrl(page.url(),role))fail('RXO_AUTH_ORIGIN_REVIEW');
    if(await appReady(page,role)||await loginFields(page,role))return;
    const network=/net::ERR_[A-Z_]+/.exec(String(e?.message||''))?.[0];
    throw new RxoAuthError('RXO_AUTH_NAVIGATION_REVIEW',network?'Browser navigation failed: '+network:'Browser navigation did not complete.');
  }
  if(!allowedAuthUrl(page.url(),role))fail('RXO_AUTH_ORIGIN_REVIEW');
}
function budget(value) {return Number.isFinite(value)&&value>=100&&value<=180000?value:120000;}
async function awaitSurface(page,role,credentials,timeoutMs,{ready=true,entry=true}={}) {
  const end=Date.now()+budget(timeoutMs); let clicked=false;
  while(Date.now()<end) {
    if(!allowedAuthUrl(page.url(),role))fail('RXO_AUTH_ORIGIN_REVIEW');
    await throwWarning(page,role,credentials);
    if(ready&&await appReady(page,role))return {ready:true};
    const fields=await loginFields(page,role); if(fields)return fields;
    if(entry&&!clicked&&allowedAuthUrl(page.url(),role)) {
      const button=await uniqueButton(page,/^(sign in|log in|login)$/i);
      if(button){clicked=true;try{await button.click({timeout:Math.min(10000,budget(timeoutMs))});}catch{fail('RXO_AUTH_FORM_NOT_READY');}}
    }
    await pause(200);
  }
  fail('RXO_AUTH_FORM_NOT_READY');
}
function record(root,role,code,phase,passwordSubmissions,message='') {
  const v={version:AUTH_VERSION,policyVersion:AUTH_POLICY_VERSION,role,code,phase,passwordSubmissions,message,
    credentialVersion:currentCredentialVersion(role,root),updatedAt:new Date().toISOString()};
  write(root,HOLD,v); write(root,LAST,v); return v;
}
const sessionResetContexts=new WeakMap();
async function refreshBrowserSession(page,role) {
  const context=page.context();
  // Clear only cookies applicable to this integration's approved RXO hosts.
  // Dedicated profiles may still contain unrelated cookies: leave those alone.
  const domain=role==='standard'?/(^|\.)rxo\.com$/i:/^(?:\.?rxo\.com|\.?expedite\.rxo\.com|\.?www\.expedite\.rxo\.com)$/i;
  await context.clearCookies({domain});
  let reset=sessionResetContexts.get(context);
  if(!reset){reset={marker:'__truckLogRxoReset_'+randomUUID(),sequence:0};sessionResetContexts.set(context,reset);}
  reset.sequence++;
  // A network error page has an opaque origin, but its tab can retain RXO
  // sessionStorage. Reset once before the first new approved document's app JS.
  // The marker survives callbacks. Monotonic sequences make older retained
  // init scripts skip a later recovery rather than erase its fresh OIDC state.
  await context.addInitScript(({role,marker,sequence})=>{
    const u=new URL(location.href);
    const approved=u.protocol==='https:'&&(role==='standard'?(u.hostname==='rxo.com'||u.hostname.endsWith('.rxo.com')):u.origin==='https://www.expedite.rxo.com');
    if(!approved)return;
    try {
      if(Number(sessionStorage.getItem(marker)||0)>=sequence)return;
      localStorage.clear();sessionStorage.clear();sessionStorage.setItem(marker,String(sequence));
    }catch{/* A storage-blocked surface must still pass the normal app checks. */}
  },{role,marker:reset.marker,sequence:reset.sequence});
  const origins=new Set([role==='standard'?'https://customer.rxoconnect.rxo.com':'https://www.expedite.rxo.com']);
  for(const frame of page.frames()) {
    if(!allowedAuthUrl(frame.url(),role))continue;
    origins.add(new URL(frame.url()).origin);
    // Only pre-existing documents are touched. Do not install an init script
    // that would erase fresh OIDC state on the next login/callback document.
    await frame.evaluate(()=>{localStorage.clear();sessionStorage.clear();}).catch(()=>undefined);
  }
  if(context.newCDPSession) {
    const session=await context.newCDPSession(page);
    try {for(const origin of origins)await session.send('Storage.clearDataForOrigin',{
      origin,storageTypes:'local_storage,indexeddb,cache_storage,service_workers',
    });}finally{await session.detach();}
  }
}
async function gated(root,role,credentials,body,page) {
  assertAuthMayRun(root,role);
  let submissions=0,recoveryId=null;
  const pending=()=>{
    if(submissions)fail('RXO_AUTH_SUBMISSION_UNCONFIRMED');
    record(root,role,'RXO_AUTH_SUBMISSION_UNCONFIRMED','BEFORE_SUBMIT',1);
    submissions=1;
  };
  try {
    recoveryId=await recoveryOperation(root,()=>{
      const recovery=recoveryRecord(root,role);return recovery?.phase==='RUNNING'?recovery.id:null;
    });
    const refreshed=await consumeSessionRefresh(root,role,recoveryId);
    if(refreshed)await refreshBrowserSession(page,role);
    const result=await body(pending,refreshed);
    write(root,LAST,{version:AUTH_VERSION,role,code:'AUTHENTICATED',phase:'COMPLETE',
      passwordSubmissions:submissions,sessionReused:submissions===0,updatedAt:new Date().toISOString()});
    releaseAuthHold(root,role);
    await completeRecovery(root,role,recoveryId,'AUTHENTICATED');
    return {...result,passwordSubmissions:submissions};
  } catch(e) {
    const code=e instanceof LockBusyError?'RXO_AUTH_STATE_REVIEW':e?.rxoAuthFailure&&CODES.has(e.code)?e.code:'RXO_AUTH_NAVIGATION_REVIEW';
    const message=e?.rxoAuthFailure?redactLoginMessage(String(e.message).replace(new RegExp('^'+code+':?\\s*'),''),credentials):'Browser interaction could not be verified. No automatic retry.';
    try {record(root,role,code,'FAILED',submissions,message);} catch {throw new RxoAuthError('RXO_AUTH_STATE_REVIEW','Could not safely record sign-in state.');}
    await completeRecovery(root,role,recoveryId,'FAILED');
    try { await notifyCredentialFailure(root,role,code,credentials.username); } catch {}
    throw new RxoAuthError(code,message.replace(new RegExp('^'+code+':?\\s*'),''));
  }
}
async function submitOnce(page,role,fields,credentials,timeoutMs,pending) {
  assertFrame(page,fields.frame,role);
  if(!fields.user)fail('RXO_AUTH_FORM_NOT_READY');
  const usernameAdvance=fields.password?null:await uniqueButton(fields.scope,/^(next|continue|sign in|log in|login)$/i);
  if(!fields.password&&!usernameAdvance)fail('RXO_AUTH_PASSWORD_STEP_NOT_READY');
  await fields.user.fill(credentials.username,{timeout:10000});
  await fields.user.press('Tab',{timeout:10000});
  if(await fields.user.inputValue({timeout:1000})!==credentials.username)fail('RXO_AUTH_INPUT_NOT_RETAINED');
  if(!fields.password) {
    const next=usernameAdvance;
    if(!next)fail('RXO_AUTH_PASSWORD_STEP_NOT_READY');
    await next.click({timeout:10000}); // Username-only step, never fallback/resubmit.
    const end=Date.now()+Math.min(budget(timeoutMs),30000); let found;
    while(Date.now()<end) {
      await throwWarning(page,role,credentials);found=await loginFields(page,role);
      if(found?.password)break; await pause(200);
    }
    if(!found?.password)fail('RXO_AUTH_PASSWORD_STEP_NOT_READY');fields=found;
  }
  assertFrame(page,fields.frame,role);
  let submit=await uniqueButton(fields.scope,/^(sign in|log in|login|log on|submit|continue)$/i);
  if(!submit) {
    const typed=await visibleAll(fields.scope.locator('button[type="submit"],input[type="submit"]'));
    if(typed.length>1)fail('RXO_AUTH_FORM_AMBIGUOUS');
    submit=typed[0]??null;
  }
  if(!submit)fail('RXO_AUTH_FORM_NOT_READY');
  await throwWarning(page,role,credentials);
  // Persist the no-retry gate before sending any password into page code.
  pending();
  await fields.password.fill(credentials.password,{timeout:10000});
  await fields.password.press('Tab',{timeout:10000});
  if(await fields.password.inputValue({timeout:1000})!==credentials.password)fail('RXO_AUTH_INPUT_NOT_RETAINED');
  assertFrame(page,fields.frame,role);
  await submit.click({timeout:15000});
}
async function afterSubmit(page,role,credentials,appUrl,timeoutMs) {
  const end=Date.now()+budget(timeoutMs);let navigated=false,stable=0,lastValidation='';
  while(Date.now()<end) {
    if(!allowedAuthUrl(page.url(),role))fail('RXO_AUTH_ORIGIN_REVIEW');
    await throwWarning(page,role,credentials);
    if(await appReady(page,role))return;
    for(const frame of page.frames())if(allowedAuthUrl(frame.url(),role)) {
      for(const alert of await visibleAll(frame.locator(ALERTS))) {
        const message=redactLoginMessage(await alert.innerText({timeout:1000}).catch(()=>''),credentials);
        if(message)lastValidation=message;
      }
    }
    const u=httpsUrl(page.url()), wanted=new URL(appUrl);
    const fields=await loginFields(page,role);
    const standardCallback=role==='standard'&&u&&/^\/signin-oidc\/?$/i.test(u.pathname);
    const returned=u&&u.origin===wanted.origin&&!fields&&
      (role==='standard'?standardPostLoginCandidate(page.url()):!/^\/WebClient\/Account\//i.test(u.pathname));
    stable=returned?stable+1:0;
    // The OIDC callback runs client-side token/session processing. Do not
    // interrupt it immediately; require ~2 seconds of stable callback state.
    const requiredStable=standardCallback?10:3;
    if(!navigated&&stable>=requiredStable) {
      navigated=true;
      await navigate(page,appUrl,Math.min(30000,Math.max(100, end-Date.now())),role);
    }
    await pause(200);
  }
  throw new RxoAuthError('RXO_AUTH_APP_NOT_READY',lastValidation||'The application page was not verified after one sign-in submission.');
}
export async function authenticateStandard(page,{username,password,dataRoot,timeoutMs=120000,forceLogin=false}={}) {
  const credentials={username,password};
  return gated(dataRoot,'standard',credentials,async (pending,refreshed)=>{
    // Known production Orders route: the scorecard need not expose Export.
    const appUrl='https://customer.rxoconnect.rxo.com/orders/list';
    if(forceLogin&&!refreshed)await refreshBrowserSession(page,'standard');
    await navigate(page,appUrl,budget(timeoutMs),'standard');
    const surface=await awaitSurface(page,'standard',credentials,timeoutMs);
    if(!surface.ready) {
      await submitOnce(page,'standard',surface,credentials,timeoutMs,pending);
      await afterSubmit(page,'standard',credentials,appUrl,timeoutMs);
    }
    return {authenticated:true,verifiedRoute:'ORDERS'};
  },page);
}
export function readExpediteGeneration(secretRoot='/run/secrets') {
  const p=read(secretRoot,'rxo_expedite_current.json');
  if(p?.contractVersion!==1||!/^[a-f0-9-]{36}$/.test(p.generation||''))fail('RXO_AUTH_STATE_REVIEW');
  return p.generation;
}
export async function authenticateExpedite(page,{username,password,dataRoot,sessionRoot,
  generation,checkGeneration=()=>generation,timeoutMs=90000}={}) {
  const credentials={username,password};
  return gated(dataRoot,'expedite',credentials,async (pending,refreshed)=>{
    if(!/^[a-f0-9-]{36}$/.test(generation||''))fail('RXO_AUTH_STATE_REVIEW');
    const prior=read(sessionRoot,BINDING);
    if(prior&&(prior.version!==AUTH_VERSION||prior.role!=='expedite'||typeof prior.generation!=='string'))fail('RXO_AUTH_SESSION_REVIEW');
    const bound=prior?.generation===generation;
    const appUrl='https://www.expedite.rxo.com/WebClient/#/freight-on-the-move';
    const loginUrl='https://www.expedite.rxo.com/WebClient/Account/Login';
    let surface;
    if(bound) {
      await navigate(page,appUrl,budget(timeoutMs),'expedite');
      surface=await awaitSurface(page,'expedite',credentials,Math.min(budget(timeoutMs),30000),{entry:false});
    } else {
      // Unbound/changed credential generation: do not reuse another identity.
      if(!refreshed)await refreshBrowserSession(page,'expedite');
      await navigate(page,loginUrl,budget(timeoutMs),'expedite');
      surface=await awaitSurface(page,'expedite',credentials,timeoutMs,{ready:false,entry:false});
    }
    if(!surface.ready) {
      await submitOnce(page,'expedite',surface,credentials,timeoutMs,pending);
      await afterSubmit(page,'expedite',credentials,appUrl,timeoutMs);
    }
    if(checkGeneration()!==generation)fail('RXO_AUTH_CREDENTIALS_CHANGED');
    write(sessionRoot,BINDING,{version:AUTH_VERSION,role:'expedite',generation,updatedAt:new Date().toISOString()});
    return {authenticated:true,verifiedRoute:'FREIGHT_ON_THE_MOVE'};
  },page);
}
// Explicit operator-only control. No sign-in, password input or export here.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [op,role,...extra]=process.argv.slice(2);
    if(extra.length||!roles.has(role)||!['--status','--retry-once'].includes(op))throw Error('Usage: --status|--retry-once standard|expedite');
    const root=role==='standard'?(process.env.RXO_DATA_DIR||'/app/data'):'/app/data';
    console.log(JSON.stringify(op==='--status'?{role,hold:readAuthHold(root,role),last:read(root,LAST)}:requestAuthRetry(root,role)));
  }catch(e){console.error(e instanceof RxoAuthError?e.message:'AUTH_CONTROL_REVIEW');process.exitCode=1;}
}
