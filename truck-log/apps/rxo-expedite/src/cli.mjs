import fs from 'node:fs';
import path from 'node:path';
import { acquireOnce, browserCloseTimedOut, fullStatus, verifyLatest } from './lib/acquisition.mjs';
import { saveCredentials } from './lib/credentials.mjs';
import { ExpediteError } from './lib/workbook.mjs';
const clean=(v,max=8192)=>{if(v==null)return null;if(typeof v!=='string'||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw new ExpediteError('LATEST_SHIPMENTS_REVIEW');return v;};
function latestShipments(root='/app/data'){
 const verified=verifyLatest(root);if(!verified)throw new ExpediteError('EXPEDITE_NOT_RUN');
 const p=path.join(root,'batches',verified.sourceBatchId,'rxo-expedite-raw.json');const st=fs.lstatSync(p);
 if(!st.isFile()||st.isSymbolicLink()||st.size>64*1024*1024)throw new ExpediteError('LATEST_SHIPMENTS_REVIEW');
 let raw;try{raw=JSON.parse(fs.readFileSync(p,'utf8'));}catch{throw new ExpediteError('LATEST_SHIPMENTS_REVIEW');}
 if(!raw||raw.contractVersion!==1||raw.source!=='RXO_EXPEDITE'||raw.dataset!=='FREIGHT_ON_THE_MOVE'||!Array.isArray(raw.records)||raw.rowCount!==raw.records.length||raw.rowCount!==verified.rowCount)throw new ExpediteError('LATEST_SHIPMENTS_REVIEW');
 const shipments=raw.records.map(r=>{if(!r||r.source!=='RXO_EXPEDITE'||typeof r.shipmentId!=='string'||!r.shipmentId||r.shipmentId.length>128||!(r.critical===null||typeof r.critical==='boolean')||!r.values||typeof r.values!=='object'||Array.isArray(r.values))throw new ExpediteError('LATEST_SHIPMENTS_REVIEW');const g=k=>{const v=r.values[k];if(k==='ETA Next Stop'&&typeof v==='number'&&Number.isFinite(v))return v;return clean(v);};return {shipmentId:r.shipmentId,critical:r.critical,authCode:g('Auth. Code'),originName:g('Origin Name'),origin:g('Origin'),destination:g('Destination'),scac:g('SCAC'),commodity:g('Commodity'),mode:g('Mode'),currentLocation:g('Current Location'),nextStop:g('Next Stop'),etaNextStop:g('ETA Next Stop'),etaStatus:g('ETA Status')};});
 return {contractVersion:1,source:'RXO_EXPEDITE',sourceBatchId:verified.sourceBatchId,completedAt:verified.completedAt,rowCount:shipments.length,observedHeaders:verified.observedHeaders,shipments};
}
function readSchedulerStatus(root='/app/data'){
 const p=path.join(root,'expedite-scheduler-status.json');
 if(!fs.existsSync(p))return {contractVersion:1,source:'RXO_EXPEDITE',version:process.env.TRUCK_LOG_RELEASE||'1.0.3',schedulerState:'NOT_STARTED',intervalMinutes:Number(process.env.RXO_EXPEDITE_SYNC_INTERVAL_MINUTES??30),syncOnStart:String(process.env.RXO_EXPEDITE_SYNC_ON_START??'true').toLowerCase()!=='false',schedulerStartedAt:null,schedulerHeartbeatAt:null,currentStartedAt:null,nextRunAt:null,lastCompletedAt:null,lastSuccessAt:null,lastFailureAt:null,lastErrorCode:null,lastDurationSeconds:null,lastSourceBatchId:null};
 const st=fs.lstatSync(p);if(!st.isFile()||st.isSymbolicLink()||st.size>32768)throw new ExpediteError('SCHEDULER_STATUS_REVIEW');
 let v;try{v=JSON.parse(fs.readFileSync(p,'utf8'));}catch{throw new ExpediteError('SCHEDULER_STATUS_REVIEW');}
 if(!v||v.contractVersion!==1||v.source!=='RXO_EXPEDITE'||typeof v.schedulerState!=='string'||!Number.isInteger(v.intervalMinutes)||v.intervalMinutes<1||v.intervalMinutes>1440)throw new ExpediteError('SCHEDULER_STATUS_REVIEW');
 return v;
}
const SETTINGS_PATH='/app/data/expedite-control-settings.json';
const boundedInterval=v=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>1440)throw new ExpediteError('SETTINGS_REVIEW');return n;};
function readSettings(){
 const defaults={intervalMinutes:boundedInterval(process.env.RXO_EXPEDITE_SYNC_INTERVAL_MINUTES??30),syncOnStart:String(process.env.RXO_EXPEDITE_SYNC_ON_START??'true').toLowerCase()!=='false'};
 if(!fs.existsSync(SETTINGS_PATH))return defaults;
 const st=fs.lstatSync(SETTINGS_PATH);if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw new ExpediteError('SETTINGS_REVIEW');
 let v;try{v=JSON.parse(fs.readFileSync(SETTINGS_PATH,'utf8'));}catch{throw new ExpediteError('SETTINGS_REVIEW');}
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['intervalMinutes','syncOnStart'].includes(k)))throw new ExpediteError('SETTINGS_REVIEW');
 return {intervalMinutes:boundedInterval(v.intervalMinutes??defaults.intervalMinutes),syncOnStart:typeof v.syncOnStart==='boolean'?v.syncOnStart:defaults.syncOnStart};
}
function saveSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['intervalMinutes','syncOnStart'].includes(k)))throw new ExpediteError('SETTINGS_REVIEW');
 const value={intervalMinutes:boundedInterval(input.intervalMinutes),syncOnStart:typeof input.syncOnStart==='boolean'?input.syncOnStart:(()=>{throw new ExpediteError('SETTINGS_REVIEW')})()};
 fs.mkdirSync(path.dirname(SETTINGS_PATH),{recursive:true});const temp=SETTINGS_PATH+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,SETTINGS_PATH);return value;
}
const args=process.argv.slice(2);
try{
 if(args.length===1&&args[0]==='--status'){const base=fullStatus();console.log(JSON.stringify({...base,schedulingEnabled:true,scheduler:readSchedulerStatus(),settings:readSettings()}));}
 else if(args.length===1&&args[0]==='--set-credentials'){
  let body='';for await(const chunk of process.stdin){body+=chunk; if(Buffer.byteLength(body)>12000)throw new ExpediteError('CREDENTIAL_INPUT_REVIEW');}
  let input;try{input=JSON.parse(body);}catch{throw new ExpediteError('CREDENTIAL_INPUT_REVIEW');}
  console.log(JSON.stringify(saveCredentials(input)));body='';if(input)input.password='';
 }
 else if(args.length===1&&args[0]==='--verify-latest'){const result=verifyLatest();if(!result)throw new ExpediteError('EXPEDITE_NOT_RUN');console.log(JSON.stringify({source:'RXO_EXPEDITE',verified:result}));}
 else if(args.length===1&&args[0]==='--latest-shipments'){console.log(JSON.stringify(latestShipments()));}
 else if(args.length===1&&args[0]==='--settings'){console.log(JSON.stringify({source:'RXO_EXPEDITE',settings:readSettings()}));}
 else if(args.length===1&&args[0]==='--set-settings'){
  let body='';for await(const chunk of process.stdin){body+=chunk;if(Buffer.byteLength(body)>8192)throw new ExpediteError('SETTINGS_REVIEW');}
  let input;try{input=JSON.parse(body);}catch{throw new ExpediteError('SETTINGS_REVIEW');}
  console.log(JSON.stringify({source:'RXO_EXPEDITE',settings:saveSettings(input)}));body='';
 }
 else if(args.length===2&&args[0]==='--once'&&args[1]==='--confirm-live-export'){
  const {chromium}=await import('playwright');const result=await acquireOnce({chromium});console.log(JSON.stringify({source:'RXO_EXPEDITE',state:'SUCCESS',...result}));
 }
 else if(!args.length||(args.length===1&&args[0]==='--help')){
  console.log('RXO_EXPEDITE verified acquisition + automatic scheduler. Database ingestion remains disabled.');
  console.log('Automatic schedule uses RXO_EXPEDITE_SYNC_INTERVAL_MINUTES (default 30). Manual live gate remains --once --confirm-live-export.');
 }else throw new ExpediteError('ARGUMENTS_REVIEW');
}catch(e){console.error(JSON.stringify({source:'RXO_EXPEDITE',errorCode:e instanceof ExpediteError?e.code:'EXPEDITE_OPERATION_FAILED'}));process.exitCode=1;}
// A Chromium that did not close must not keep a finished one-shot command alive.
if(browserCloseTimedOut())setTimeout(()=>process.exit(process.exitCode??0),1000).unref();
