'use strict';
// These tests have NO Windows, database, network, or printer side effects.
const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const C=require('./core.cjs');
const tests=[];const test=(n,f)=>tests.push([n,f]);
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const T=Date.parse('2026-09-11T19:00:00Z');
const pdf=Buffer.from('%PDF-1.4\nexample test fixture, not a printable document\n%%EOF\n');
const cfg={agentVersion:C.VERSION,apiBase:'https://trucklog.example/api/v1',agentId:'trucklog-print-pc-01',route:'RXO_DRIVER_DOCUMENT',sourceQueue:'Truck Log RXO Driver Documents',printer:'Guard Printer 1',allowHttp:false,installId:'b228ff77-c7fa-4d78-bfc6-9ac7f83b3f41'};
cfg.hostName='USFTWLDAPP';cfg.printers=[{gate:'EAST',printer:cfg.printer,sourceQueue:cfg.sourceQueue},{gate:'WEST',printer:'Guard Printer 2',sourceQueue:'Truck Log West'}];
const job={itemId:'95250796-a880-4454-a227-32916d450d39',packageId:'21bd27af-9052-4a07-ae9d-e67489302533',attemptNumber:1,route:cfg.route,printer:cfg.printer,sha256:C.sha(pdf),claimToken:'a'.repeat(64),fileSizeBytes:pdf.length,leaseExpiresAt:new Date(T+120000).toISOString(),downloadUrl:'/api/v1/print-agents/jobs/95250796-a880-4454-a227-32916d450d39/document'};
const freshJob=(now,extra={})=>{const id=crypto.randomUUID();return {...job,itemId:id,downloadUrl:'/api/v1/print-agents/jobs/'+id+'/document',claimToken:crypto.randomBytes(32).toString('hex'),leaseExpiresAt:new Date(now+120000).toISOString(),...extra};};
const online=()=>({agents:[{agentId:cfg.agentId,enabled:true,status:'ONLINE',agentVersion:C.VERSION,lastSeen:new Date(T).toISOString(),configuredRoutes:cfg.printers.map(p=>({route:cfg.route,outputPrinter:p.printer}))}]});
// In-memory stand-in for a sealed file; values are deep-copied like a real write/read.
function memStore(init=null){let v=clone(init);const s={writes:0,fail:null,load:()=>clone(v),save:x=>{if(s.fail)s.fail(x);v=clone(x);s.writes++;},get value(){return clone(v);}};return s;}
// File-backed store: survives a simulated service restart (new Worker from the same files).
function fileStore(file){return {load:()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null,save:v=>C.atomicWrite(file,JSON.stringify(v))};}
function harness(state=null){
  let stored=clone(state), prints=0, t=T, claims=0;
  const calls={claim:[],pdf:[],report:[],saves:[],logs:[]};
  const api={claim:async(b,k)=>{calls.claim.push([clone(b),k]);return {job:claims++===0?clone(job):freshJob(t)};},pdf:async j=>{calls.pdf.push(clone(j));return Buffer.from(pdf);},report:async(j,b,k)=>{calls.report.push([clone(j),clone(b),k]);return {items:[{id:j.itemId,status:b.success?'PRINTED':'FAILED'}]};}};
  const box=memStore([]),jr=memStore([]);
  const opts={config:clone(cfg),api,load:()=>clone(stored),save:s=>{stored=clone(s);calls.saves.push(clone(s));},printer:async()=>{prints++;assert.equal(stored.phase,'PRINT_INTENT');},now:()=>t,log:m=>calls.logs.push(C.cleanError(m))};
  const h={api,calls,opts,box,jr,mk:()=>new C.Worker({...opts,outbox:new C.ResultOutbox({load:box.load,save:box.save,now:()=>t}),journal:new C.ReviewJournal({load:jr.load,save:jr.save,now:()=>t})}),
    advance(ms){t+=ms;},get t(){return t;},get stored(){return clone(stored);},get prints(){return prints;},get outbox(){return box.value||[];},get journal(){return jr.value||[];}};
  h.w=h.mk();return h;
}
test('request IDs use valid length and alphabet',()=>{for(const op of ['heartbeat','claim','result'])for(let i=0;i<100;i++)assert.match(C.key(op),/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/);});
test('request IDs are unique across 1000 calls',()=>assert.equal(new Set(Array.from({length:1000},()=>C.key('claim'))).size,1000));
test('invalid request prefix is rejected',()=>assert.throws(()=>C.key('too-long-invalid-prefix')));
test('site URL is normalized',()=>assert.equal(C.apiBase('https://trucklog.example/'),'https://trucklog.example/api/v1'));
test('explicit API base is normalized',()=>assert.equal(C.apiBase('http://vm.example:4300/api/v1/'),'http://vm.example:4300/api/v1'));
for(const u of ['ftp://example','https://a:b@example','https://example/?x=1','https://example/#x','https://example/rxo'])test('unsafe API URL rejected: '+u,()=>assert.throws(()=>C.apiBase(u)));
test('known configuration is accepted',()=>assert.equal(C.validConfig(clone(cfg)).printer,cfg.printer));
for(const [name,value]of [['agentVersion','4-old'],['agentId','a'],['printer',' x '],['route',''],['sourceQueue','bad\nqueue'],['installId','invalid']])test('invalid configuration '+name+' rejected',()=>assert.throws(()=>{const c=clone(cfg);if(['printer','sourceQueue'].includes(name))c.printers[0][name]=value;else c[name]=value;C.validConfig(c);}));
test('plaintext transport requires acknowledgement',()=>assert.throws(()=>C.validConfig({...cfg,apiBase:'http://vm.example/api/v1'})));
test('acknowledged internal HTTP accepted',()=>assert.equal(C.validConfig({...cfg,apiBase:'http://vm.example/api/v1',allowHttp:true}).allowHttp,true));
test('exact frozen job accepted',()=>assert.equal(C.validateJob(clone(job),cfg,T).itemId,job.itemId));
for(const [name,value]of [['itemId','not-uuid'],['packageId','not-uuid'],['attemptNumber',0],['route','other'],['printer','Other Printer'],['claimToken','secret'],['sha256','wrong'],['fileSizeBytes',C.MAX_PDF+1],['downloadUrl','https://evil.example/doc'],['leaseExpiresAt',new Date(T-1).toISOString()]])test('invalid job '+name+' rejected',()=>assert.throws(()=>C.validateJob({...job,[name]:value},cfg,T)));
test('complete PDF size/hash/header accepted',()=>C.verifyPdf(Buffer.from(pdf),job));
test('truncated PDF rejected',()=>assert.throws(()=>C.verifyPdf(pdf.subarray(0,-4),job)));
test('same-length modified PDF rejected',()=>{const b=Buffer.from(pdf);b[10]=88;assert.throws(()=>C.verifyPdf(b,job));});
test('HTML content cannot masquerade as a PDF',()=>{const b=Buffer.from('<html>wrong file</html>');assert.throws(()=>C.verifyPdf(b,{fileSizeBytes:b.length,sha256:C.sha(b)}));});
test('PDF missing end marker rejected even with matching hash',()=>{const b=Buffer.from('%PDF-1.4 incomplete');assert.throws(()=>C.verifyPdf(b,{fileSizeBytes:b.length,sha256:C.sha(b)}));});
test('exact online identity/version/route/printer accepted',()=>assert.equal(C.exactOnline(online(),cfg,new Date(T).toISOString()),true));
for(const [field,value]of [['agentId','different-agent'],['enabled',false],['status','OFFLINE'],['agentVersion','old'],['lastSeen',new Date(T-10000).toISOString()],['configuredRoutes',[{route:cfg.route,outputPrinter:'OTHER'}]]])test('unrelated or stale online '+field+' rejected',()=>{const s=online();s.agents[0][field]=value;assert.equal(C.exactOnline(s,cfg,new Date(T).toISOString()),false);});
test('duplicate exact agent IDs do not pass health',()=>{const s=online();s.agents.push(clone(s.agents[0]));assert.equal(C.exactOnline(s,cfg,new Date(T).toISOString()),false);});
test('errors redact bearer credentials',()=>assert.ok(!C.cleanError('failed tlpa_'+'a'.repeat(16)+'_'+'b'.repeat(64)).includes('tlpa_')));
test('errors redact claim digests and control characters',()=>{const x=C.cleanError('oops\n'+'f'.repeat(64));assert.ok(!x.includes('\n')&&!x.includes('f'.repeat(64)));});
test('atomic state write replaces exactly one file',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'tl4-test-'));try{const f=path.join(d,'state');C.atomicWrite(f,'one');C.atomicWrite(f,'two');assert.equal(fs.readFileSync(f,'utf8'),'two');assert.deepEqual(fs.readdirSync(d),['state']);}finally{fs.rmSync(d,{recursive:true,force:true});}});
test('happy print saves intent before invoking renderer',async()=>{const h=harness();await h.w.tick();assert.equal(h.prints,1);assert.equal(h.stored,null);assert.deepEqual(h.calls.saves.filter(Boolean).map(x=>x.phase),['CLAIM','ACQUIRED','PRINT_INTENT']);assert.deepEqual(h.outbox,[]);});
test('success report uses frozen printer and claim',async()=>{const h=harness();await h.w.tick();const b=h.calls.report[0][1];assert.equal(b.success,true);assert.equal(b.printer,cfg.printer);assert.equal(b.claimToken,job.claimToken);assert.ok(!('error'in b));});
test('empty queue does not print or report',async()=>{const h=harness();h.api.claim=async()=>({job:null});await h.w.tick();assert.equal(h.prints,0);assert.equal(h.calls.report.length,0);assert.equal(h.stored,null);});
test('lost claim reply retries same key and body',async()=>{const h=harness();const orig=h.api.claim;let failed=false;h.api.claim=async(b,k)=>{const r=await orig(b,k);if(!failed){failed=true;throw Error('network');}return r;};await assert.rejects(h.w.tick());assert.equal(h.stored.phase,'CLAIM');await h.w.tick();assert.deepEqual(h.calls.claim[0],h.calls.claim[1]);assert.equal(h.prints,1);});
test('expired uncertain claim is not replayed and does not block polling',async()=>{const h=harness({phase:'CLAIM',createdAt:T-26*60000,key:C.key('claim'),body:{routes:[cfg.route],agentVersion:C.VERSION}});await h.w.tick();assert.equal(h.stored,null);assert.equal(h.calls.claim.length,0);assert.equal(h.journal.length,1);await h.w.tick();assert.equal(h.calls.claim.length,1);assert.equal(h.prints,1);});
test('malformed saved claim is discarded before any API request',async()=>{const h=harness({phase:'CLAIM'});await h.w.tick();assert.equal(h.stored,null);assert.equal(h.calls.claim.length,0);assert.equal(h.journal.length,1);});
test('unknown durable phase is discarded without printing',async()=>{const h=harness({phase:'UNKNOWN'});await h.w.tick();assert.equal(h.stored,null);assert.equal(h.prints,0);assert.equal(h.journal.length,1);});
test('malicious job route never reaches document download',async()=>{const h=harness();h.api.claim=async()=>({job:{...job,route:'other'}});await h.w.tick();assert.equal(h.stored,null);assert.equal(h.journal.length,1);assert.equal(h.calls.pdf.length,0);assert.equal(h.prints,0);assert.equal(h.calls.report.length,0);});
test('hash failure reports failure without printing',async()=>{const h=harness();h.api.pdf=async()=>Buffer.from('not a pdf');await h.w.tick();assert.equal(h.prints,0);assert.equal(h.calls.report[0][1].success,false);assert.equal(h.stored,null);});
test('short lease does not enter print intent',async()=>{const h=harness({phase:'ACQUIRED',job:{...job,leaseExpiresAt:new Date(T+10000).toISOString()}});await h.w.tick();assert.equal(h.prints,0);assert.equal(h.calls.report[0][1].success,false);});
test('interruption at PRINT_INTENT reports FAILED-uncertain and never reprints',async()=>{const h=harness({phase:'PRINT_INTENT',job});await h.w.tick({claim:false});await h.w.tick({claim:false});assert.equal(h.prints,0);assert.equal(h.calls.pdf.length,0);assert.equal(h.calls.report.length,1);const b=h.calls.report[0][1];assert.equal(b.success,false);assert.match(b.error,/uncertain/i);assert.equal(h.calls.report[0][0].itemId,job.itemId);});
test('renderer error is uncertain: reported FAILED, never PRINTED, never reprinted',async()=>{const h=harness();h.opts.printer=async()=>{throw Error('renderer exit 1');};const w=h.mk();await w.tick();assert.equal(h.stored,null);assert.equal(h.calls.report.length,1);assert.equal(h.calls.report[0][1].success,false);assert.match(h.calls.report[0][1].error,/uncertain/i);});
test('after an uncertain renderer error the loop keeps claiming NEW jobs',async()=>{const h=harness();const seen=[];h.opts.printer=async(b,j)=>{seen.push(j.itemId);if(seen.length===1)throw Error('printer');};const w=h.mk();await w.tick();await w.tick();assert.equal(h.calls.claim.length,2);assert.equal(seen.length,2);assert.notEqual(seen[0],seen[1]);assert.deepEqual(h.calls.report.map(r=>r[1].success),[false,true]);});
test('lost success result is resent unchanged without a second physical print',async()=>{const h=harness();const orig=h.api.report;let failed=false;h.api.report=async(...a)=>{const r=await orig(...a);if(!failed){failed=true;throw Error('network');}return r;};await h.w.tick();assert.equal(h.outbox.length,1);assert.equal(h.stored,null);h.advance(C.OUTBOX.firstMs);await h.w.tick({claim:false});assert.equal(h.prints,1);assert.deepEqual(h.calls.report[0],h.calls.report[1]);assert.deepEqual(h.outbox,[]);});
test('restart with pending V4R6 REPORT never downloads or prints',async()=>{const k=C.key('result');const body={claimToken:job.claimToken,success:true,submittedAt:new Date(T).toISOString(),printer:cfg.printer};const h=harness({phase:'REPORT',job,key:k,body});await h.w.tick();assert.equal(h.prints,0);assert.equal(h.calls.pdf.length,0);assert.equal(h.stored,null);assert.equal(h.calls.report[0][2],k);assert.deepEqual(h.calls.report[0][1],body);assert.deepEqual(h.outbox,[]);});
test('HTTP 200 with expired/FAILED summary is not success and does not stall polling',async()=>{const h=harness();let first=true;h.api.report=async(j,b)=>{const s=first?'FAILED':(b.success?'PRINTED':'FAILED');first=false;return {items:[{id:j.itemId,status:s}]};};await h.w.tick();assert.equal(h.journal.length,1);assert.match(h.journal[0].message,/did not confirm the expected PRINTED/);assert.deepEqual(h.outbox,[]);assert.equal(h.prints,1);await h.w.tick();assert.equal(h.prints,2);assert.equal(h.calls.claim.length,2);});
test('wrong result item cannot finalize the current print',async()=>{const h=harness();h.api.report=async()=>({items:[{id:job.packageId,status:'PRINTED'}]});await h.w.tick();assert.equal(h.journal.length,1);assert.deepEqual(h.outbox,[]);});
for(const status of [400,401,403,404,409,410])test('terminal report HTTP '+status+' goes to review without reprint or stall',async()=>{const h=harness();h.api.report=async()=>{throw new C.HttpFailure('result',status);};await h.w.tick();assert.equal(h.journal.length,1);assert.deepEqual(h.outbox,[]);assert.equal(h.stored,null);assert.equal(h.prints,1);});
for(const status of [401,403])test('report HTTP '+status+' while heartbeat is failing keeps the result for resend',async()=>{const h=harness({phase:'REPORT',job,key:C.key('result'),body:{claimToken:job.claimToken,success:true,submittedAt:new Date(T).toISOString(),printer:cfg.printer}});h.api.report=async()=>{throw new C.HttpFailure('result',status);};await h.w.tick({claim:false,credentialOk:false});assert.equal(h.outbox.length,1);assert.equal(h.journal.length,0);});
test('database/API 500 keeps immutable success pending in the outbox',async()=>{const h=harness();h.api.report=async()=>{throw new C.HttpFailure('result',500);};await h.w.tick();assert.equal(h.stored,null);assert.equal(h.outbox.length,1);assert.equal(h.outbox[0].body.success,true);assert.equal(h.outbox[0].attempts,1);});
test('failed-result network retry cannot switch to success',async()=>{const h=harness();h.api.pdf=async()=>{throw new C.HttpFailure('document',409);};const orig=h.api.report;let n=0;h.api.report=async(...a)=>{const r=await orig(...a);if(n++===0)throw Error('lost');return r;};await h.w.tick();h.advance(C.OUTBOX.firstMs);await h.w.tick({claim:false});assert.deepEqual(h.calls.report[0],h.calls.report[1]);assert.equal(h.calls.report[1][1].success,false);assert.equal(h.prints,0);});
test('cannot print when durable claim save fails',async()=>{const h=harness();h.opts.save=()=>{throw Error('disk');};const w=h.mk();await assert.rejects(w.tick());assert.equal(h.calls.claim.length,0);assert.equal(h.prints,0);});
test('cannot print when durable intent save fails',async()=>{const h=harness();const save=h.opts.save;h.opts.save=s=>{if(s&&s.phase==='PRINT_INTENT')throw Error('disk');save(s);};const w=h.mk();await w.tick();assert.equal(h.prints,0);assert.equal(h.calls.report[0][1].success,false);});
test('result write failure after printing never repeats renderer or reports uncertain',async()=>{const h=harness();h.box.fail=x=>{if(x.length)throw Error('disk');};const w=h.mk();await assert.rejects(w.tick());assert.equal(h.prints,1);await assert.rejects(w.tick());assert.equal(h.prints,1);assert.equal(h.calls.report.length,0);h.box.fail=null;await w.tick({claim:false});assert.equal(h.prints,1);assert.equal(h.calls.report.length,1);assert.equal(h.calls.report[0][1].success,true);});
test('V4R6 REVIEW hold is archived to the journal and polling resumes',async()=>{const h=harness({phase:'REVIEW',message:'inspect'});await h.w.tick();assert.equal(h.stored,null);assert.equal(h.journal.length,1);assert.match(h.w.error(),/REVIEW/);assert.match(h.w.error(),/inspect/);assert.equal(h.calls.claim.length,0);await h.w.tick();assert.equal(h.calls.claim.length,1);});
function response(body,options={}){return new Response(body,{headers:{'content-type':'application/json',...options.headers},status:options.status||200});}
test('API sends bearer/idempotency/body and forbids redirects',async()=>{let got;const api=new C.Api(cfg.apiBase,'private-fixture',async(u,o)=>{got=[u,o];return response('{"accepted":true}');});await api.heartbeat(cfg,null);assert.equal(got[0],cfg.apiBase+'/print-agents/heartbeat');assert.equal(got[1].headers.Authorization,'Bearer private-fixture');assert.match(got[1].headers['X-Idempotency-Key'],/^tl4-heartbeat-/);assert.equal(got[1].redirect,'error');assert.deepEqual(JSON.parse(got[1].body).configuredRoutes,cfg.printers.map(p=>({route:cfg.route,sourceQueue:p.sourceQueue,outputPrinter:p.printer})));});
test('public status request does not send credential',async()=>{let got;const api=new C.Api(cfg.apiBase,'fixture',async(u,o)=>{got=o;return response('{"agents":[]}');});await api.request('GET','/print-agents/status',null,null,{auth:false});assert.equal(got.headers.Authorization,undefined);});
test('PDF request carries frozen claim only on exact API path',async()=>{let got;const api=new C.Api(cfg.apiBase,'fixture',async(u,o)=>{got=[u,o];return response(pdf,{headers:{'content-type':'application/pdf'}});});assert.deepEqual(await api.pdf(job),pdf);assert.equal(got[0],'https://trucklog.example'+job.downloadUrl);assert.equal(got[1].headers['X-Print-Claim-Token'],job.claimToken);});
test('HTML response rejected',async()=>{const api=new C.Api(cfg.apiBase,'x',async()=>response('html',{headers:{'content-type':'text/html'}}));await assert.rejects(api.claim({},C.key('claim')));});
test('malformed JSON rejected',async()=>{const api=new C.Api(cfg.apiBase,'x',async()=>response('{'));await assert.rejects(api.claim({},C.key('claim')));});
test('HTTP 401 retained as structured failure without raw body',async()=>{const api=new C.Api(cfg.apiBase,'x',async()=>response('secret raw body',{status:401}));await assert.rejects(api.claim({},C.key('claim')),e=>e.status===401&&!e.message.includes('secret'));});
test('oversized Content-Length rejected',async()=>{const api=new C.Api(cfg.apiBase,'x',async()=>response('{}',{headers:{'content-length':'99999999'}}));await assert.rejects(api.claim({},C.key('claim')));});
test('oversized streamed JSON rejected without Content-Length',async()=>{const api=new C.Api(cfg.apiBase,'x',async()=>response('x'.repeat(2*1024*1024+1)));await assert.rejects(api.claim({},C.key('claim')));});
test('redirect/TLS errors do not log raw request credentials',async()=>{const api=new C.Api(cfg.apiBase,'private',async()=>{throw Error('private-url-token');});await assert.rejects(api.claim({},C.key('claim')),e=>!e.message.includes('private-url-token'));});
test('unsafe API traversal is blocked before fetch',async()=>{let called=false;const api=new C.Api(cfg.apiBase,'x',async()=>{called=true;});await assert.rejects(api.request('GET','/../evil',null,null));assert.equal(called,false);});
test('renderer uses argument array and no shell',async()=>{let options;const spawn=(e,a,o)=>{options=o;assert.equal(a[0],'a b');const child=new EventEmitter();setImmediate(()=>child.emit('exit',0));return child;};await C.printProcess('app.exe',['a b'],1000,spawn);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);});
test('nonzero renderer exit rejected',async()=>{const spawn=()=>{const p=new EventEmitter();setImmediate(()=>p.emit('exit',1));return p;};await assert.rejects(C.printProcess('x',[],1000,spawn));});
test('renderer launch error rejected',async()=>{const spawn=()=>{const p=new EventEmitter();setImmediate(()=>p.emit('error',Error('no exe')));return p;};await assert.rejects(C.printProcess('x',[],1000,spawn));});
test('renderer timeout kills only the owned process and is uncertain',async()=>{let killed=0;const spawn=()=>{const p=new EventEmitter();p.kill=()=>{killed++;};return p;};await assert.rejects(C.printProcess('x',[],15,spawn),/uncertain/);assert.equal(killed,1);});

// Additional two-gate and activation checks, on the actual final dual core.
const routing=()=>({contract:'truck-log-dual-gate-v1',configurationValid:true,frozenPrinterRequired:true,claimUsesAdvertisedPrinters:true,agentId:cfg.agentId,route:cfg.route,gates:cfg.printers.map(p=>({gate:p.gate,printer:p.printer,configured:true}))});
test('server routing capability resolves both saved printers',()=>assert.equal(C.routingConfig(routing()).printers.length,2));
for(const [field,value]of [['contract','old'],['configurationValid',false],['frozenPrinterRequired',false],['claimUsesAdvertisedPrinters',false],['agentId','!'],['route','bad\nroute']])test('invalid server capability rejected '+field,()=>assert.throws(()=>C.routingConfig({...routing(),[field]:value})));
test('unsaved gate mapping cannot use UI defaults',()=>{const r=routing();r.gates[0].configured=false;assert.throws(()=>C.routingConfig(r));});
test('duplicate gate key rejected',()=>{const r=routing();r.gates[1].gate='EAST';assert.throws(()=>C.routingConfig(r));});
test('duplicate physical printer rejected case insensitively',()=>{const c=clone(cfg);c.printers[1].printer=c.printers[0].printer.toUpperCase();assert.throws(()=>C.validConfig(c));});
test('single printer configuration rejected',()=>assert.throws(()=>C.validConfig({...cfg,printers:[cfg.printers[0]]})));
test('wrong Windows host configuration rejected',()=>assert.throws(()=>C.validConfig({...cfg,hostName:'DEVELOPMENT'})));
test('mapping change is detected without rerouting',()=>{const r=routing();assert(C.mappingMatches(r,cfg));r.gates[1].printer='new';assert(!C.mappingMatches(r,cfg));});
test('ONLINE with East alone is not setup success',()=>{const s=online();s.agents[0].configuredRoutes.splice(1);assert(!C.exactOnline(s,cfg,new Date(T).toISOString()));});
test('heartbeat advertises East and West simultaneously',async()=>{let body;const a=new C.Api(cfg.apiBase,'fixture',async(u,o)=>{body=JSON.parse(o.body);return response('{}');});await a.heartbeat(cfg);assert.deepEqual(body.configuredRoutes.map(r=>r.outputPrinter),['Guard Printer 1','Guard Printer 2']);});
test('setup heartbeat advertises NO usable route before physical confirmation',async()=>{let body;const a=new C.Api(cfg.apiBase,'fixture',async(u,o)=>{body=JSON.parse(o.body);return response('{}');});await a.heartbeat(cfg,null,false);assert.deepEqual(body.configuredRoutes,[]);});
test('WEST job never uses EAST config printer',async()=>{const h=harness();h.api.claim=async()=>({job:{...job,printer:'Guard Printer 2'}});let selected;h.opts.printer=async(b,j)=>{selected=j.printer;};const w=h.mk();await w.tick();assert.equal(selected,'Guard Printer 2');assert.equal(h.calls.report[0][1].printer,'Guard Printer 2');});
test('unknown third printer is sent to review before download',async()=>{const h=harness();h.api.claim=async()=>({job:{...job,printer:'THIRD'}});await h.w.tick();assert.equal(h.journal.length,1);assert.equal(h.calls.pdf.length,0);});
test('WEST lost result retry retains WEST without a second print',async()=>{const h=harness();h.api.claim=async()=>({job:{...job,printer:'Guard Printer 2'}});const orig=h.api.report;let count=0;h.api.report=async(...args)=>{const v=await orig(...args);if(count++===0)throw Error('network');return v;};await h.w.tick();h.advance(C.OUTBOX.firstMs);await h.w.tick({claim:false});assert.equal(h.prints,1);assert.equal(h.calls.report[0][1].printer,'Guard Printer 2');assert.deepEqual(h.calls.report[0],h.calls.report[1]);});
test('corrupt result destination is never sent',async()=>{const h=harness({phase:'REPORT',job,key:C.key('result'),body:{claimToken:job.claimToken,success:true,submittedAt:new Date(T).toISOString(),printer:'WRONG'}});await h.w.tick();assert.equal(h.journal.length,1);assert.equal(h.calls.report.length,0);assert.deepEqual(h.outbox,[]);});
test('renderer args keep UNC destination one argument and never default',()=>{const p='\\\\USFTWPLVPS03\\USFTWP_W_Gate_Pass';const args=C.renderArgs(p,'a b.pdf','data');assert.equal(args[args.indexOf('-print-to')+1],p);assert(!args.includes('-print-to-default'));assert.equal(args.at(-1),'a b.pdf');});
const A=require('./agent.cjs');
test('only East confirmation cannot activate',()=>assert(!A.activationMatches({installId:cfg.installId,eastConfirmed:true},cfg)));
test('both confirmations and current install ID required',()=>{assert(A.activationMatches({installId:cfg.installId,eastConfirmed:true,westConfirmed:true},cfg));assert(!A.activationMatches({installId:'old',eastConfirmed:true,westConfirmed:true},cfg));});

// ---- V4R7: transient printer failures never stall the poll loop ----
const down=msg=>new C.NotPrinted(msg||'EAST printer not accessible to LocalSystem (Win32 1722).');
test('printer briefly unreachable, then recovers: loop continues and the job prints exactly once',async()=>{
  const h=harness();let checks=0;h.opts.preflight=async()=>{if(++checks<=2)throw down();};const w=h.mk();
  await w.tick();assert.equal(h.stored.phase,'ACQUIRED');assert.equal(h.stored.tries,1);assert.equal(h.calls.pdf.length,0);assert.equal(h.prints,0);assert.equal(h.calls.report.length,0);
  await w.tick();assert.equal(checks,1,'backoff honoured: no re-check before retryAt');
  assert.match(w.error(),/Printer retry pending/);
  h.advance(2000);await w.tick();assert.equal(h.stored.tries,2);assert.equal(h.stored.retryAt,h.t+4000);
  h.advance(4000);await w.tick();assert.equal(h.prints,1);assert.equal(h.stored,null);assert.equal(h.calls.report.length,1);assert.equal(h.calls.report[0][1].success,true);
  await w.tick();assert.equal(h.calls.claim.length,2,'next job claimed; loop not wedged');assert.equal(h.prints,2);assert.equal(h.journal.length,0);
});
test('renderer that could not start is retried in the same lease, not treated as uncertain',async()=>{
  const h=harness();let runs=0;h.opts.printer=async()=>{if(++runs===1)throw new C.NotPrinted('Print renderer could not start');};const w=h.mk();
  await w.tick();assert.equal(h.stored.phase,'ACQUIRED');assert.equal(h.calls.report.length,0);
  h.advance(2000);await w.tick();assert.equal(runs,2);assert.equal(h.calls.report.length,1);assert.equal(h.calls.report[0][1].success,true);assert.equal(h.stored,null);
});
test('printer down for the whole lease: reported FAILED (not printed) within the lease, then polling continues',async()=>{
  const h=harness();h.opts.preflight=async()=>{throw down();};const w=h.mk();let n=0;
  while(h.stored===null||h.stored?.phase==='ACQUIRED'||h.stored?.phase==='CLAIM'){await w.tick();if(h.calls.report.length)break;h.advance(1000);assert.ok(++n<500,'bounded');}
  const b=h.calls.report[0][1];assert.equal(b.success,false);assert.match(b.error,/Not printed/);assert.equal(h.prints,0);
  assert.ok(h.t<Date.parse(job.leaseExpiresAt),'reported while the lease was still valid');assert.equal(h.stored,null);
  assert.ok(h.calls.logs.filter(l=>/printer not ready/.test(l)).length<=C.PRINT_RETRY.maxTries,'bounded retries');
  h.opts.preflight=async()=>{};const w2=h.mk();await w2.tick();assert.equal(h.calls.claim.length,2);assert.equal(h.prints,1);
});
test('backoff is bounded and grows',()=>{assert.deepEqual([1,2,3,4,5,6,30].map(n=>C.backoff(n,2000,30000)),[2000,4000,8000,16000,30000,30000,30000]);});
test('renderer launch error is NotPrinted; nonzero exit and timeout stay uncertain',async()=>{
  const mk=ev=>()=>{const p=new EventEmitter();p.kill=()=>{};if(ev)setImmediate(()=>p.emit(...ev));return p;};
  await assert.rejects(C.printProcess('x',[],1000,mk(['error',Error('ENOENT')])),e=>e.notPrinted===true);
  await assert.rejects(C.printProcess('x',[],1000,()=>{throw Error('spawn EPERM');}),e=>e.notPrinted===true);
  await assert.rejects(C.printProcess('x',[],1000,mk(['exit',1])),e=>e.notPrinted!==true);
  await assert.rejects(C.printProcess('x',[],15,mk(null)),e=>e.notPrinted!==true&&/uncertain/.test(e.message));
});
test('one unreachable gate is not advertised; the other gate keeps printing',async()=>{
  const g=C.accessibleGates(cfg,{sid:'S-1-5-18',machine:'usftwldapp',gates:[{gate:'EAST',printer:cfg.printers[0].printer,accessible:false,win32Error:1722},{gate:'WEST',printer:cfg.printers[1].printer,accessible:true,win32Error:0}]});
  assert.deepEqual(g.ok.map(p=>p.gate),['WEST']);assert.deepEqual(g.down.map(p=>[p.gate,p.win32Error]),[['EAST',1722]]);
  let body;const a=new C.Api(cfg.apiBase,'fixture',async(u,o)=>{body=JSON.parse(o.body);return response('{}');});await a.heartbeat(cfg,'x',g.ok);
  assert.deepEqual(body.configuredRoutes.map(r=>r.outputPrinter),['Guard Printer 2']);
});
test('printer probe from the wrong identity is still refused',()=>{assert.throws(()=>C.accessibleGates(cfg,{sid:'S-1-5-20',machine:'USFTWLDAPP',gates:[]}));assert.throws(()=>C.accessibleGates(cfg,{sid:'S-1-5-18',machine:'OTHER',gates:[]}));});

// ---- V4R7: durable, idempotent result delivery ----
// Fake Truck Log server reproducing the result contract of reportIfOwned(): one result per item,
// X-Idempotency-Key replay returns the stored response, a different body under a used key is 409.
function fakeServer(clock){
  const s={items:new Map(),keys:new Map(),recorded:[],resultPosts:[],failResults:0,loseNextResponse:false,queue:[]};
  s.enqueue=()=>{const j=freshJob(clock());delete j.claimToken;s.queue.push(j);return j;};
  s.fetch=async(url,o)=>{
    const route=url.slice(cfg.apiBase.length),json=(b,st=200)=>new Response(JSON.stringify(b),{status:st,headers:{'content-type':'application/json'}});
    if(o.headers.Authorization!=='Bearer tlpa_fixture')return json({},401);
    if(route==='/print-agents/jobs/claim'){const j=s.queue.shift();if(!j)return json({job:null});const token=crypto.randomBytes(32).toString('hex');s.items.set(j.itemId,{status:'LEASED',token,job:j});return json({job:{...j,claimToken:token}});}
    const doc=route.match(/^\/print-agents\/jobs\/([0-9a-f-]{36})\/document$/);if(doc)return new Response(pdf,{status:200,headers:{'content-type':'application/pdf'}});
    const res=route.match(/^\/print-agents\/jobs\/([0-9a-f-]{36})\/result$/);
    if(res){
      const k=o.headers['X-Idempotency-Key'],body=o.body;s.resultPosts.push({item:res[1],key:k,body});
      if(s.failResults>0){s.failResults--;return json({message:'unavailable'},503);}
      const prev=s.keys.get(k);let response;
      if(prev){if(prev.body!==body)return json({},409);response=prev.response;}
      else{const it=s.items.get(res[1]),input=JSON.parse(body);if(!it||input.claimToken!==it.token)return json({},401);
        if(it.status==='LEASED'){it.status=input.success?'PRINTED':'FAILED';s.recorded.push({item:res[1],success:input.success});}
        else if((it.status==='PRINTED')!==input.success)return json({},409);
        response={items:[{id:res[1],status:it.status}]};s.keys.set(k,{body,response});}
      if(s.loseNextResponse){s.loseNextResponse=false;throw new Error('socket hang up after commit');}
      return json(response);
    }
    return json({},404);
  };
  return s;
}
test('result post fails N times then succeeds: delivered exactly once and survives a restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tl4r7-outbox-'));
  try{
    let t=T;const clock=()=>t,srv=fakeServer(clock);srv.enqueue();srv.failResults=6;
    let prints=0;const logs=[];
    const boot=()=>{const st=fileStore(path.join(dir,'state.json'));return new C.Worker({config:clone(cfg),api:new C.Api(cfg.apiBase,'tlpa_fixture',srv.fetch),load:st.load,save:st.save,
      outbox:new C.ResultOutbox({...fileStore(path.join(dir,'outbox.json')),now:clock}),journal:new C.ReviewJournal({...fileStore(path.join(dir,'journal.json')),now:clock}),
      printer:async()=>{prints++;},now:clock,log:m=>logs.push(C.cleanError(m))});};
    let w=boot();
    await w.tick();assert.equal(prints,1);assert.equal(srv.resultPosts.length,1);assert.equal(srv.recorded.length,0);
    for(let i=0;i<2;i++){t+=C.OUTBOX.maxMs;await w.tick({claim:false});}
    assert.equal(srv.resultPosts.length,3);
    // Simulated service restart: a brand-new worker reading only what is on disk.
    w=null;w=boot();assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'outbox.json'),'utf8')).length,1);assert.equal(fs.readFileSync(path.join(dir,'state.json'),'utf8'),'null');
    for(let i=0;i<3;i++){t+=C.OUTBOX.maxMs;await w.tick({claim:false});}
    assert.equal(srv.resultPosts.length,6);assert.equal(srv.recorded.length,0);
    srv.loseNextResponse=true;t+=C.OUTBOX.maxMs;await w.tick({claim:false}); // committed, reply lost
    assert.equal(srv.recorded.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'outbox.json'),'utf8')).length,1);
    t+=C.OUTBOX.maxMs;await w.tick({claim:false});                       // replay returns stored response
    assert.equal(srv.resultPosts.length,8);assert.deepEqual(srv.recorded,[{item:srv.resultPosts[0].item,success:true}]);
    assert.equal(new Set(srv.resultPosts.map(p=>p.key)).size,1,'one idempotency key for every resend');
    assert.equal(new Set(srv.resultPosts.map(p=>p.body)).size,1,'byte-identical body for every resend');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'outbox.json'),'utf8')),[]);
    t+=C.OUTBOX.maxMs;await w.tick({claim:false});w=boot();await w.tick({claim:false});
    assert.equal(srv.resultPosts.length,8,'nothing re-sent after acknowledgement, even after another restart');assert.equal(prints,1);
    assert.ok(logs.every(l=>!l.includes('tlpa_')),'credential never logged');
    assert.ok(fs.readdirSync(dir).every(f=>!fs.readFileSync(path.join(dir,f),'utf8').includes('tlpa_')),'credential never stored with results');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('results are flushed even when new claims are not allowed (stale heartbeat)',async()=>{const k=C.key('result');const h=harness({phase:'REPORT',job,key:k,body:{claimToken:job.claimToken,success:true,submittedAt:new Date(T).toISOString(),printer:cfg.printer}});await h.w.tick({claim:false,credentialOk:false});assert.equal(h.calls.report.length,1);assert.equal(h.calls.claim.length,0);assert.deepEqual(h.outbox,[]);});
test('full outbox applies backpressure: no new claims and no result is dropped',async()=>{
  const h=harness();let posts=0;h.api.report=async()=>{posts++;throw new C.HttpFailure('result',503);};
  const entries=Array.from({length:C.OUTBOX.maxEntries},()=>{const j=freshJob(T);return {key:C.key('result'),job:j,body:{claimToken:j.claimToken,success:true,submittedAt:new Date(T).toISOString(),printer:j.printer},createdAt:T,attempts:0,nextAt:0};});
  h.box.save(entries);const w=h.mk();await w.tick();
  assert.equal(h.calls.claim.length,0);assert.equal(h.outbox.length,C.OUTBOX.maxEntries);assert.equal(posts,1,'one failed post per round, not a storm');
});
test('a result unacknowledged for 6 days moves to review instead of being resent forever',async()=>{const h=harness({phase:'REPORT',job,key:C.key('result'),body:{claimToken:job.claimToken,success:true,submittedAt:new Date(T).toISOString(),printer:cfg.printer}});let posts=0;h.api.report=async()=>{posts++;throw Error('down');};await h.w.tick({claim:false});assert.equal(h.outbox.length,1);h.advance(C.OUTBOX.maxAgeMs+1);await h.w.tick({claim:false});assert.deepEqual(h.outbox,[]);assert.equal(h.journal.length,1);assert.equal(posts,1);});
test('duplicate handoff of the same result is stored once',()=>{const b=memStore([]);const o=new C.ResultOutbox({...b});const e={key:C.key('result'),job,body:{claimToken:job.claimToken,success:true,submittedAt:new Date(T).toISOString(),printer:cfg.printer}};assert.equal(o.add(e),true);assert.equal(o.add(e),false);assert.equal(o.add({...e,key:C.key('result')}),false);assert.equal(b.value.length,1);});
test('review journal is bounded',()=>{const b=memStore([]);const j=new C.ReviewJournal({...b});for(let i=0;i<250;i++)j.add('r'+i,job);assert.equal(b.value.length,200);assert.equal(b.value[199].message,'r249');});
test('heartbeat error text surfaces pending results without leaking claim tokens',async()=>{const h=harness();h.api.report=async()=>{throw Error('down '+job.claimToken);};await h.w.tick();const e=h.w.error();assert.match(e,/awaiting server confirmation/);assert.ok(!e.includes(job.claimToken));assert.ok(h.calls.logs.every(l=>!l.includes(job.claimToken)));});
test('V4R6 config and its pending claim stay valid after an in-place update',async()=>{assert.equal(C.validConfig({...clone(cfg),agentVersion:'4.0.6-service'}).agentId,cfg.agentId);const k=C.key('claim'),body={routes:[cfg.route],agentVersion:'4.0.6-service'};const h=harness({phase:'CLAIM',createdAt:T-60000,key:k,body});await h.w.tick();assert.deepEqual(h.calls.claim[0],[body,k]);assert.equal(h.prints,1);});
test('acquired job is not printed while heartbeats fail, but pending results still flush',async()=>{const h=harness();let fail=true;h.api.report=async(j,b)=>{if(fail)throw Error('down');return {items:[{id:j.itemId,status:'PRINTED'}]};};await h.w.tick();assert.equal(h.outbox.length,1);fail=false;h.opts.preflight=async()=>{throw down();};const w=h.mk();await w.tick();assert.equal(h.stored.phase,'ACQUIRED');h.advance(C.OUTBOX.firstMs);await w.tick({claim:false,print:false,credentialOk:false});assert.deepEqual(h.outbox,[]);assert.equal(h.stored.tries,1,'no print progress without a healthy heartbeat');});
test('document download 503 is retried in the lease; 409 is reported FAILED',async()=>{const h=harness();let n=0;h.api.pdf=async()=>{if(++n===1)throw new C.HttpFailure('document',503);return Buffer.from(pdf);};await h.w.tick();assert.equal(h.stored.phase,'ACQUIRED');h.advance(2000);await h.w.tick();assert.equal(h.prints,1);assert.equal(h.calls.report[0][1].success,true);const g=harness();g.api.pdf=async()=>{throw new C.HttpFailure('document',409);};await g.w.tick();assert.equal(g.prints,0);assert.equal(g.calls.report[0][1].success,false);assert.equal(g.stored,null);});

async function main(){let pass=0;for(const[n,f]of tests){try{await f();console.log('[PASS] '+n);pass++;}catch(e){console.error('[FAIL] '+n+'\n'+e.stack);process.exitCode=1;return;}}console.log('V4R7 isolated agent tests: '+pass+'/'+tests.length+' PASS. No live Windows, API, or printer actions performed.');}
if(require.main===module)main();
module.exports={main};
