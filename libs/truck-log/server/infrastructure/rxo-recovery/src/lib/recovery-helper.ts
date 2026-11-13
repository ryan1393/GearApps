/** Fixed helper program: no shell, external URLs, credential values or profile access. */
export const RECOVERY_HELPER = `
import fs from 'node:fs';
import * as auth from '/app/src/lib/rxo-auth.mjs';
const [role,operation]=process.argv.slice(1);
if(!['standard','expedite'].includes(role)||!['status','request','acknowledge'].includes(operation))process.exit(2);
try{
 const file='/app/data/'+(role==='standard'?'scheduler-status.json':'expedite-scheduler-status.json');
 let scheduler=null;
 try{
  const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)throw new Error();
  const v=JSON.parse(fs.readFileSync(file,'utf8'));
  scheduler={state:role==='standard'?v.currentPhase:v.schedulerState,heartbeatAt:v.schedulerHeartbeatAt,deadlineAt:v.schedulerLoopDeadlineAt};
 }catch{scheduler=null;}
 const recovery=await(operation==='status'?auth.connectionRecoveryStatus('/app/data',role):operation==='request'?auth.requestConnectionRecovery('/app/data',role):auth.acknowledgeAuthHold('/app/data',role));
 console.log(JSON.stringify({role,recovery,scheduler}));
}catch{console.log(JSON.stringify({role,recovery:{available:false,requested:false,reason:'STATE_REVIEW',requiresCredentials:false,requiresInteractiveLogin:false},scheduler:null}));}
`;
