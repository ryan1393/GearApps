import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript';

const root=process.cwd(), require=createRequire(import.meta.url);
const common={Injectable:()=>x=>x, Logger:class{}, ConflictException:class extends Error{}, NotFoundException:class extends Error{}, UnauthorizedException:class extends Error{}, ServiceUnavailableException:class extends Error{}};
const helpers={SHA:/^[a-f0-9]{64}$/,UUID:/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, required(ok,message){if(!ok)throw new Error(message)},text:x=>String(x??'').trim(),key:x=>assert.match(x,/^[A-Za-z0-9._:-]{16,128}$/),iso:x=>x?new Date(x).toISOString():null,oneUpdated:(r,id)=>assert.equal(String(r[0].id),String(id))};
const data={returnedRows:r=>r,exactlyOneRowUpdated:(r,id)=>r.length===1&&Number(r[0].id)===Number(id),canonicalJsonSha256:x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')};
function load(file,imports={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Buffer,console,require(name){if(name in imports)return imports[name];if(name==='@nestjs/common')return common;if(name==='@nestjs/typeorm')return {InjectRepository:()=>()=>{}};if(name==='@truck-log/server/data-access')return data;if(name==='./automatic-driver-print.helpers')return helpers;if(name.startsWith('node:'))return require(name);return{};}},{filename:file});
 return module.exports;
}
const base='libs/truck-log/server/';
let passed=0;
const {TruckVisitsService}=load(base+'feature/visits/src/lib/truck-visits.service.ts');
const visits=Object.create(TruckVisitsService.prototype);
visits.plantLocationName=async()=>'Fort Wayne';
visits.driverPrint={getGateRoutingStatus:async()=>({configurationValid:true,gates:[{available:false}]})};
assert.equal((await visits.checkInConfig()).automaticDriverPrinting,false);passed++;
visits.driverPrint.getGateRoutingStatus=async()=>({configurationValid:true,gates:[{available:true}]});
assert.equal((await visits.checkInConfig()).automaticDriverPrinting,true);passed++;

const {RxoDocumentUploadCommand}=load(base+'feature/rxo-documents/src/lib/rxo-document-upload.command.ts',{
 './rxo-document.model':{RXO_CHECK_IN_RACE_GRACE_MS:600000,MATERIALS_UPLOAD_SOURCE:'MATERIALS_UPLOAD',RXO_DRIVER_DOCUMENT_TYPE:'RXO_DRIVER_DOCUMENT',asNumber:x=>Number(x),mapStorageError:e=>{throw e}},
 './rxo-document-idempotency.store':{rememberIdempotentResponse:async()=>{}},
});
for(const scenario of [{automaticExisting:true,manual:false,expected:0},{automaticExisting:false,manual:true,expected:0},{automaticExisting:false,manual:false,expected:1}]){
 let prints=0;
 const manager={query:async(sql)=>{
  if(sql.includes('SELECT document.id,'))return[{id:11,sha256:'a'.repeat(64),rxo_document_version:1,truck_visit_id:1}];
  if(sql.includes('SELECT id, rxo_document_version'))return[{id:11,rxo_document_version:1}];
  if(sql.includes('AS eligible_for_initial_package'))return[{id:1,eligible_for_initial_package:true,manual_printing:scenario.manual}];
  if(sql.includes('SET rxo_is_active = FALSE'))return[{id:11}];
  if(sql.includes('INSERT INTO visit_documents'))return[{id:12}];
  if(sql.includes('SELECT j.id FROM automatic_driver_print_packages'))return scenario.automaticExisting?[{id:'frozen'}]:[];
  return[];
 }};
 const command=new RxoDocumentUploadCommand({storeRxoPdf:async()=>({fileName:'v2.pdf',fileSizeBytes:20,sha256:'b'.repeat(64),relativePath:'rxo/new.pdf'})},{createOriginalPackage:async()=>{prints++;}},{assertShipmentExists:async()=>{},uploadResponse:async()=>({id:12})});
 const result=await command.storeNewVersion(manager,{identity:{siteKey:'fort-wayne',shipmentId:'LOAD',direction:'INBOUND'},file:{buffer:Buffer.alloc(20),originalname:'v2.pdf'},pdfSha256:'b'.repeat(64),actor:{key_id:'materials',subject_id:'materials',display_name:'Materials'},idempotencyKey:'replacement-12345',requestSha256:'hash',now:new Date()},{});
 assert.equal(result.id,12);assert.equal(prints,scenario.expected);passed++;
}

const {associateActiveRxoDocument}=load(base+'feature/visits/src/lib/visit-rxo-association.ts');
let manualPrints=0;
const associationQueries=[];
await associateActiveRxoDocument({query:async(sql)=>{associationQueries.push(sql);return sql.includes('SELECT id, truck_visit_id')?[{id:7,truck_visit_id:null,rxo_document_version:1,sha256:'a'.repeat(64)}]:sql.includes('UPDATE visit_documents')?[{id:7}]:[];}},{createOriginalPackage:async()=>{manualPrints++;}},{create:x=>x,save:async()=>{}},{id:1},{siteKey:'fort-wayne',shipmentId:'LOAD',direction:'INBOUND'},null,'Guard',new Date(),false);
assert.equal(manualPrints,0);assert(associationQueries.some(x=>x.includes('UPDATE visit_documents')));passed++;

const {AutomaticDriverPrintRecovery}=load(base+'domain/driver-print/src/lib/automatic-driver-print-recovery.ts');
const guard='12345678-1234-4123-8123-123456789012';
const recovery=new AutomaticDriverPrintRecovery({transaction:async fn=>fn({query:async sql=>sql.includes('SELECT j.*')?[{id:'job',status:'FAILED',leased_at:new Date(),client_request_id:guard}]:[]})},{});
await assert.rejects(recovery.recover('package','recovery-key-123456',guard,{itemType:'DOCK_ASSIGNMENT',action:'CANCEL',reason:'Manual fallback'}),/delivered to a printer/);passed++;
await assert.rejects(recovery.recover('package','recovery-key-123456','00000000-0000-4000-8000-000000000000',{itemType:'DOCK_ASSIGNMENT',action:'CANCEL',reason:'Manual fallback'}),/Original check-in/);passed++;
const lockOrder=[];
const busyRecovery=new AutomaticDriverPrintRecovery({transaction:async fn=>fn({query:async sql=>{
 lockOrder.push(sql);
 if(sql.includes('SELECT j.*'))return[{id:'job',item_type:'RXO_DOCUMENT',visit_document_id:11,status:'FAILED',leased_at:null,client_request_id:guard}];
 if(sql.includes('SELECT id FROM automatic_driver_print_jobs'))return[{id:'already-queued-copy'}];
 return[];
}})},{});
await assert.rejects(busyRecovery.recover('package','recovery-busy-123456',guard,{itemType:'RXO_DOCUMENT',action:'REPLACE',gate:'WEST',reason:'Queue removed'}),/in-progress print/);
assert.match(lockOrder[0],/FOR UPDATE OF original/);
assert.match(lockOrder[1],/FOR UPDATE OF j/);passed++;
console.log(`[PASS] Workflow reliability: ${passed} runtime regression cases.`);

if(process.env.TRUCK_LOG_WORKFLOW_TEST_DATABASE_URL){
 const {Client}=require('pg');
 const conf={connectionString:process.env.TRUCK_LOG_WORKFLOW_TEST_DATABASE_URL};
 const a=new Client(conf),b=new Client(conf);await a.connect();await b.connect();
 const schema='workflow_test_'+Date.now();
 try{
  await a.query(`CREATE SCHEMA ${schema}`);
  await a.query(`CREATE TABLE ${schema}.locations(id serial primary key,name text not null,active boolean,last_used_at timestamptz,created_at timestamptz,updated_at timestamptz)`);
  await a.query(`CREATE UNIQUE INDEX ON ${schema}.locations ((LOWER(BTRIM(name))))`);
  await a.query(`INSERT INTO ${schema}.locations(name,active) VALUES('Supplier',true),('Fort Wayne',true)`);
  const {upsertLocationPair}=load(base+'feature/visits/src/lib/visit-reference-upserts.ts');
  const manager=c=>({query:async(sql,params)=>(await c.query(sql,params)).rows});
  for(const c of[a,b]){await c.query('BEGIN');await c.query(`SET LOCAL search_path=${schema}`);await c.query("SET LOCAL lock_timeout='5s'");}
  const first=upsertLocationPair(manager(a),'Supplier','Fort Wayne',new Date()).then(async ids=>{await a.query('COMMIT');return ids;});
  const second=upsertLocationPair(manager(b),'Fort Wayne','Supplier',new Date()).then(async ids=>{await b.query('COMMIT');return ids;});
  const [inbound,outbound]=await Promise.all([first,second]);
  assert.equal(inbound[0],outbound[1]);assert.equal(inbound[1],outbound[0]);
  console.log('[PASS] Two-connection PostgreSQL opposite-direction location upserts complete without deadlock.');
  await a.query('BEGIN');
  const managerDb={query:async(sql,params)=>(await a.query(sql,params)).rows};
  const db={query:managerDb.query,transaction:async fn=>fn(managerDb)};
  const agent='workflow-test-'+randomUUID(), packet=randomUUID(), job=randomUUID(), requestId=randomUUID();
  await a.query(`INSERT INTO print_agents(agent_id,display_name,enabled,last_seen_at,configured_routes)
    VALUES($1,'Workflow test',true,NOW(),$2::jsonb)`,[agent,JSON.stringify([{route:'RXO_DRIVER_DOCUMENT',outputPrinter:'ReplacementQueue'}])]);
  const visitRow=await a.query(`INSERT INTO truck_visits(visit_number,load_number,direction,carrier_name,driver_name,driver_phone,
    tractor_id,trailer_id,is_drop_trailer,origin_name,destination_name,dock_code,status,document_folder_key,guard_check_in_at,dock_assigned_at,client_request_id)
    VALUES($1,'WORKFLOW-TEST','INBOUND','Carrier','Driver','2605551212','TRACTOR','TRAILER',false,'Supplier','Fort Wayne','100','DOCK_ASSIGNED','workflow-test',NOW(),NOW(),$2) RETURNING id`,['WORKFLOW-'+randomUUID(),requestId]);
  const visitId=visitRow.rows[0].id;
  await a.query(`INSERT INTO automatic_driver_print_packages(id,truck_visit_id,gate,agent_id,route,printer,requested_by)
    VALUES($1,$2,'EAST',$3,'RXO_DRIVER_DOCUMENT','RemovedQueue','Guard')`,[packet,visitId,agent]);
  const pdf=Buffer.from('%PDF-1.4\nWorkflow test frozen bytes\n%%EOF');
  await a.query(`INSERT INTO automatic_driver_print_jobs(id,package_id,item_type,pdf_bytes,file_name,file_size_bytes,sha256)
    VALUES($1,$2,'DOCK_ASSIGNMENT',$3,'dock.pdf',$4,$5)`,[job,packet,pdf,pdf.length,createHash('sha256').update(pdf).digest('hex')]);
  await a.query('INSERT INTO automatic_driver_print_attempts(job_id,attempt_number,request_key) VALUES($1,1,$2)',[job,'original-'+job]);
  await a.query(`INSERT INTO app_settings(key,value) VALUES('driver_print_west_printer','ReplacementQueue')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  const {AutomaticDriverPrintStore}=load(base+'domain/driver-print/src/lib/automatic-driver-print.store.ts');
  const config={get:(key,fallback)=>key==='TRUCK_LOG_DRIVER_PRINT_AGENT_ID'?agent:key==='TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET'?'a'.repeat(64):fallback};
  const store=new AutomaticDriverPrintStore(config);
  assert.equal(await store.reconcileQueued(managerDb),1);
  assert.equal((await store.summary(managerDb,packet)).items[0].status,'FAILED');
  assert.equal((await store.summary(managerDb,packet)).items[0].recoverable,true);
  const recoverDb=new AutomaticDriverPrintRecovery(db,store);
  const replacement=await recoverDb.recover(packet,'recovery-key-123456',requestId,{itemType:'DOCK_ASSIGNMENT',action:'REPLACE',gate:'WEST',reason:'Old queue removed'});
  assert.notEqual(replacement.packageId,packet);assert.equal(replacement.items[0].status,'QUEUED');
  const replay=await recoverDb.recover(packet,'recovery-key-123456',requestId,{itemType:'DOCK_ASSIGNMENT',action:'REPLACE',gate:'WEST',reason:'Old queue removed'});
  assert.equal(replay.packageId,replacement.packageId);
  const original=(await store.summary(managerDb,packet)).items[0];assert.equal(original.cancelled,true);assert.equal(original.recoverable,false);
  assert.equal(original.replacementPackageId,replacement.packageId);
  const snapshots=await a.query('SELECT id,printer FROM automatic_driver_print_packages WHERE id=ANY($1::uuid[])',[ [packet,replacement.packageId] ]);
  assert.equal(snapshots.rows.find(x=>x.id===packet).printer,'RemovedQueue');
  assert.equal(snapshots.rows.find(x=>x.id===replacement.packageId).printer,'ReplacementQueue');
  const frozen=await a.query('SELECT pdf_bytes,sha256 FROM automatic_driver_print_jobs WHERE package_id=$1',[replacement.packageId]);
  assert.deepEqual(frozen.rows[0].pdf_bytes,pdf);
  const {AutomaticDriverPrintRequests}=load(base+'domain/driver-print/src/lib/automatic-driver-print-requests.ts');
  await assert.rejects(new AutomaticDriverPrintRequests(db,store).retryIfOwned(packet,'DOCK_ASSIGNMENT','retry-cancelled-12345',requestId),/cancelled or replaced/);
  assert.equal((await a.query('SELECT count(*)::int AS n FROM automatic_print_job_recoveries WHERE job_id=$1',[job])).rows[0].n,1);
  const cancelled=await recoverDb.recover(replacement.packageId,'cancel-replacement-12345',requestId,{itemType:'DOCK_ASSIGNMENT',action:'CANCEL',reason:'Use browser printing'});
  assert.equal(cancelled.items[0].cancelled,true);assert.equal(cancelled.items[0].replacementPackageId,null);
  await a.query('SAVEPOINT protected_history');
  await assert.rejects(a.query('DELETE FROM automatic_print_job_recoveries WHERE job_id=$1',[job]),/immutable/);
  await a.query('ROLLBACK TO SAVEPOINT protected_history');
  await a.query('ROLLBACK');
  console.log('[PASS] PostgreSQL unavailable queue failure, safe replacement, immutable PDF/printer, idempotent replay and cancelled retry rejection.');

 }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');await a.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await a.end();await b.end();}
}else console.log('[SKIP] PostgreSQL concurrency case: set TRUCK_LOG_WORKFLOW_TEST_DATABASE_URL to an isolated test database.');
