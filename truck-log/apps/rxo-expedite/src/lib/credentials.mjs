/** Extends the existing named credential volume; no standard RXO reads or fallback. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExpediteError } from './workbook.mjs';
import { acquireLock } from './process-lock.mjs';
export const USER_FILE='rxo_expedite_username';
export const PASS_FILE='rxo_expedite_password';
const POINTER='rxo_expedite_current.json',VERSIONS='rxo_expedite_versions';
const must=(v,c)=>{if(!v)throw new ExpediteError(c);};
function dir(p){const s=fs.lstatSync(p);must(s.isDirectory()&&!s.isSymbolicLink(),'CREDENTIAL_STORAGE_REVIEW');}
function read(p,max){const s=fs.lstatSync(p);must(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'CREDENTIAL_STORAGE_REVIEW');return fs.readFileSync(p,'utf8');}
export function validateCredentials(user,password){
 must(typeof user==='string'&&!!user.trim()&&user.trim().length<=256&&!/[\x00-\x1f\x7f]/.test(user),'EXPEDITE_USERNAME_REQUIRED');
 must(typeof password==='string'&&password.length>0&&password.length<=2048&&!/[\x00-\x1f\x7f]/.test(password),'EXPEDITE_PASSWORD_REQUIRED');
 return {username:user.trim(),password};
}
export function readCredentials(root='/run/secrets'){
 try{
  dir(root);const pointer=JSON.parse(read(path.join(root,POINTER),2048));
  must(pointer.contractVersion===1&&typeof pointer.generation==='string'&&/^[a-f0-9-]{36}$/.test(pointer.generation),'CREDENTIAL_STORAGE_REVIEW');
  const versions=path.join(root,VERSIONS),generation=path.join(versions,pointer.generation);dir(versions);dir(generation);
  return validateCredentials(read(path.join(generation,USER_FILE),1024),read(path.join(generation,PASS_FILE),8192));
 }catch(e){if(e?.code==='ENOENT')throw new ExpediteError('EXPEDITE_CREDENTIALS_NOT_CONFIGURED');if(e instanceof ExpediteError)throw e;throw new ExpediteError('CREDENTIAL_STORAGE_REVIEW');}
}
export function credentialStatus(root='/run/secrets'){
 try{const c=readCredentials(root);return {username:c.username,usernameConfigured:true,passwordConfigured:true,configured:true};}
 catch(e){if(e.code==='EXPEDITE_CREDENTIALS_NOT_CONFIGURED')return {username:'',usernameConfigured:false,passwordConfigured:false,configured:false};throw e;}
}
function currentGeneration(root){
 try{const pointer=JSON.parse(read(path.join(root,POINTER),2048));return typeof pointer?.generation==='string'&&/^[a-f0-9-]{36}$/.test(pointer.generation)?pointer.generation:null;}
 catch{return null;}
}
/** Old passwords must not accumulate: keep the new generation and the one it replaced
 * (a run that read the old pointer a moment ago can still open its files). */
function pruneGenerations(versions,keep){
 for(const entry of fs.readdirSync(versions,{withFileTypes:true})){
  if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9-]{36}$/.test(entry.name)||keep.includes(entry.name))continue;
  try{fs.rmSync(path.join(versions,entry.name),{recursive:true,force:true});}catch{}
 }
}
export function saveCredentials(input,root='/run/secrets'){
 must(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['username','password'].includes(k)),'CREDENTIAL_INPUT_REVIEW');
 dir(root);let lock;
 // A save takes milliseconds; a lock older than two minutes belongs to a killed writer.
 try{lock=acquireLock(path.join(root,'.rxo_expedite_write_lock'),{code:'CREDENTIAL_UPDATE_BUSY',purpose:'expedite credential update',staleAfterMs:120000,maxHoldMs:120000,log:()=>{}});}
 catch(e){if(e?.code==='CREDENTIAL_UPDATE_BUSY')throw new ExpediteError('CREDENTIAL_UPDATE_BUSY');throw new ExpediteError('CREDENTIAL_STORAGE_REVIEW');}
 let generation,committed=false,previous=null;
 try{
  // An omitted/empty replacement retains ONLY an already-committed Expedite password.
  let password=input.password;
  if(password===undefined||password==='')password=readCredentials(root).password;
  previous=currentGeneration(root);
  const c=validateCredentials(input.username,password),versions=path.join(root,VERSIONS);
  if(!fs.existsSync(versions))fs.mkdirSync(versions,{mode:0o700});dir(versions);
  const id=randomUUID();generation=path.join(versions,id);fs.mkdirSync(generation,{mode:0o700});
  fs.writeFileSync(path.join(generation,USER_FILE),c.username,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(generation,PASS_FILE),c.password,{flag:'wx',mode:0o600});
  // Read-back is local and never serialized. A pointer switch publishes the whole pair.
  must(read(path.join(generation,USER_FILE),1024)===c.username&&read(path.join(generation,PASS_FILE),8192)===c.password,'CREDENTIAL_STORAGE_REVIEW');
  const temp=path.join(root,'.rxo_expedite_current-'+id+'.tmp');
  fs.writeFileSync(temp,JSON.stringify({contractVersion:1,generation:id})+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(temp,path.join(root,POINTER));committed=true;
  pruneGenerations(versions,[id,previous]);
  return {username:c.username,usernameConfigured:true,passwordConfigured:true,configured:true,passwordUpdated:typeof input.password==='string'&&input.password.length>0};
 }catch(e){if(e instanceof ExpediteError)throw e;throw new ExpediteError('CREDENTIAL_STORAGE_REVIEW');}
 finally{if(!committed&&generation)try{fs.rmSync(generation,{recursive:true});}catch{};lock.release();}
}
