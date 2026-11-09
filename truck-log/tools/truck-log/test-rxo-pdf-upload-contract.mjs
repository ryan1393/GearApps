// Source and isolated-runtime regressions. No server, DB or external account.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
const root = process.cwd();
const rxoDocuments = 'libs/truck-log/server/feature/rxo-documents/src/lib/';
const accessAuth = 'libs/truck-log/server/auth/access/src/lib/';
// RXO Data tab upload state and actions live in RxoDataStore; browser PDF checks are shared in web data-access.
const componentPath = 'libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-data.store.ts';
const pdfUploadPath = 'libs/truck-log/web/data-access/src/lib/pdf-upload.ts';
const apiPath = 'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts';
const read = p => fs.readFileSync(path.join(root,p),'utf8');
let checks=0;
function check(ok,label){if(!ok)throw Error(label);checks++;console.log('[PASS] '+label);}
async function rejected(fn,label){let error;try{await fn();}catch(e){error=e;}check(!!error,label);return error;}
const decorate = () => () => {};
const common = new Proxy({Logger:class{error(){} warn(){} log(){} debug(){}}}, {get(o,k){return k in o?o[k]:String(k).endsWith('Exception')?class extends Error{constructor(message){super(message);this.name=k;}}:decorate;}});
class HttpHeaders {
  constructor(values={}){this.values={...values};}
  set(k,v){return new HttpHeaders({...this.values,[k.toLowerCase()]:v});}
  get(k){return this.values[k.toLowerCase()]??null;}
}
const componentWindow={confirm:()=>true, prompt:()=>{throw Error('Password prompt must not run');},sessionStorage:new Proxy({}, {get(){throw Error('Credential storage must not be accessed');}})};
const cache=new Map();
const stripComponentMetadata = context=>file=>ts.visitNode(file,function walk(n){
  if(ts.isClassDeclaration(n)&&n.name?.text==='RxoDataStore')return context.factory.updateClassDeclaration(n,n.modifiers?.filter(m=>!ts.isDecorator(m)),n.name,n.typeParameters,n.heritageClauses,n.members);
  return ts.visitEachChild(n,walk,context);
});
function load(rel){
 if(cache.has(rel))return cache.get(rel);
 const source=read(rel), ast=ts.createSourceFile(rel,source,ts.ScriptTarget.Latest,true);
 check(ast.parseDiagnostics.length===0,'TypeScript parser: '+path.basename(rel));
 const compiled=ts.transpileModule(source,{fileName:rel,reportDiagnostics:true,transformers:{before:[stripComponentMetadata]},compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}});
 check(!compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),'TypeScript transpiler: '+path.basename(rel));
 const exports={};cache.set(rel,exports);
 const ctx={exports,module:{exports},console,Buffer,URL,TextDecoder,FormData,File,Date,Intl,Number,String,Math,encodeURIComponent,setInterval,clearInterval,window:componentWindow,
 require(name){
  if(name.startsWith('node:'))return require(name);
  if(name==='@nestjs/common')return common;
  if(name==='@nestjs/typeorm')return {InjectRepository:decorate};
  if(name==='@truck-log/server/data-access')return load('libs/truck-log/server/data-access/src/lib/support/request-integrity.ts');
  if(name==='@truck-log/server/domain/rxo')return load('libs/truck-log/server/domain/rxo/src/lib/rxo-document-lock.ts');
  if(name==='@angular/core')return {Component:decorate,Injectable:decorate};
  if(name==='@angular/common/http')return {HttpHeaders};
  if(name==='@truck-log/web/data-access')return load(pdfUploadPath);
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(rel),name+'.ts'));
  if(name.startsWith('.')&&['rxo-browser-upload-actor.ts','rxo-document-lock.ts','rxo-document-pdf-validation.ts','rxo-document-orphan-reconciler.ts','rxo-document-orphan-schedule.ts','rxo-document.model.ts','rxo-document.queries.ts','rxo-document-idempotency.store.ts','rxo-document-upload.command.ts'].some(n=>resolved.endsWith(n)))return load(resolved);
  return {};
 }};
 vm.runInNewContext(compiled.outputText,ctx,{filename:rel,timeout:5000});return exports;
}
const guard=load(rxoDocuments+'rxo-browser-upload.guard.ts');
const valid={'x-truck-log-upload':'browser-v1','content-type':'multipart/form-data; boundary=test','origin':'http://trucklog:4300','host':'trucklog','sec-fetch-site':'same-origin'};
for(const [label,delta,origins,port] of [
 ['standard Nginx host without external port',{}],['explicit external port',{host:'trucklog:4300'}],
 ['development proxy',{host:'localhost:3334',origin:'http://localhost:4300'}],
 ['HTTPS default port',{host:'trucklog',origin:'https://trucklog'}],
 ['IPv6 host',{host:'[::1]:3334',origin:'http://[::1]:4300'}],
 ['configured non-default web port',{origin:'http://trucklog:4400'},'', '4400'],
 ['configured trusted page origin',{origin:'https://portal.example'},'https://portal.example'],
 ['legacy browser without fetch metadata',{'sec-fetch-site':undefined}],
 ])check(guard.rxoBrowserUploadRequestError({...valid,...delta},origins,port)===null,label+' accepted');
for(const [label,delta] of [
 ['missing request marker',{'x-truck-log-upload':undefined}],['wrong request marker',{'x-truck-log-upload':'anything'}],
 ['array request marker',{'x-truck-log-upload':['browser-v1','browser-v1']}],['non-multipart body',{'content-type':'application/json'}],
 ['missing origin',{origin:undefined}],['opaque origin',{origin:'null'}],['origin with a path',{origin:'http://trucklog:4300/path'}],
 ['origin with trailing slash',{origin:'http://trucklog:4300/'}],['origin containing credentials',{origin:'http://user@trucklog:4300'}],
 ['origin with non-HTTP scheme',{origin:'file://trucklog'}],['different hostname',{origin:'http://evil.example:4300'}],
 ['same hostname at wrong port',{origin:'http://trucklog:4700'}],['cross-site browser',{'sec-fetch-site':'cross-site'}],
 ['same-site but cross-origin browser',{'sec-fetch-site':'same-site'}],['invalid host',{host:'trucklog@evil.example'}],
 ['duplicate host',{host:['trucklog','other']}],['host with newline',{host:'trucklog\r\nInjected: yes'}],
 ['forwarded-host spoof',{origin:'http://evil.example:4300','x-forwarded-host':'evil.example'}],
 ])check(!!guard.rxoBrowserUploadRequestError({...valid,...delta}),label+' rejected');
const configured={get:()=>undefined};
const instance=new guard.RxoBrowserUploadGuard(configured);
check(instance.canActivate({switchToHttp:()=>({getRequest:()=>({headers:valid})})})===true,'Nest guard allows valid browser request with no credential');
await rejected(()=>instance.canActivate({switchToHttp:()=>({getRequest:()=>({headers:{...valid,origin:'null'}})})}),'Nest guard rejects invalid page before upload');
const actor=load(rxoDocuments+'rxo-browser-upload-actor.ts'), principal=actor.RXO_BROWSER_UPLOAD_PRINCIPAL;
let actorQuery;
const manager={query:async(sql,params)=>{actorQuery={sql,params};return [{key_id:params[0],subject_id:params[1],display_name:params[2]}];}};
const identity=await actor.ensureRxoBrowserUploadActor(manager);
check(Object.isFrozen(principal)&&identity.key_id===principal.keyId,'stable internal audit actor');
check(actorQuery.sql.includes('FALSE, NOW(), NOW()')&&actorQuery.params[3]==='0'.repeat(64),'audit row is inactive, revoked and has no usable password');
check(actorQuery.sql.includes('ON CONFLICT (key_id) DO UPDATE SET last_used_at = NOW()'),'repeat upload only touches reserved actor timestamp');
check(['subject_id = $2','display_name = $3','secret_sha256 = $4','active = FALSE','revoked_at IS NOT NULL','expires_at IS NULL'].every(x=>actorQuery.sql.includes(x)),'audit collision cannot overwrite an existing credential');
check(actorQuery.sql.includes('["rxo-documents:write"]')&&!actorQuery.sql.includes('rxo-documents:reprint'),'audit identity does not grant reprint permission');
await rejected(()=>actor.ensureRxoBrowserUploadActor({query:async()=>[]}),'reserved audit identity collision fails closed');
const service=load(rxoDocuments+'rxo-documents.service.ts').RxoDocumentsService;
const file={originalname:'delivery.pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF\n'),mimetype:'application/pdf'};
let delegated;
const wrapper=Object.create(service.prototype);wrapper.upload=(...args)=>{delegated=args;return 'uploaded';};
check(await wrapper.uploadFromBrowser('0123456789abcdef','site','OUTBOUND','shipment',file)==='uploaded','browser service uses existing upload implementation');
check(delegated[0]===principal&&delegated[1]==='0123456789abcdef'&&delegated[2]==='site'&&delegated[3]==='OUTBOUND'&&delegated[4]==='shipment'&&delegated[5]===file,'same shipment, direction, file and idempotency key reach transaction');
let validationCalls=0,authCalls=0,locks=0,auditCalls=0;
const replay={version:2,fileName:'delivery.pdf'}, replayService=Object.create(service.prototype);
replayService.validatePdf=()=>{validationCalls++;return 'f'.repeat(64);};
replayService.dataSource={transaction:async callback=>callback({query:async(sql,params)=>{auditCalls++;return [{key_id:params[0],subject_id:params[1],display_name:params[2]}];}})};
replayService.advisoryLock=async()=>locks++;
replayService.revalidateCredential=async key=>{authCalls++;return {key_id:key};};
replayService.priorIdempotentResponse=async()=>replay;
check(await replayService.uploadFromBrowser('0123456789abcdef','site','OUTBOUND','SHIP',file)===replay,'passwordless route retains successful idempotent replay');
check(validationCalls===1&&locks===2&&auditCalls===1&&authCalls===0,'browser path preserves PDF and transaction locks without authenticating a user');
check(await replayService.upload({...principal},'0123456789abcdef','site','OUTBOUND','SHIP',file)===replay&&authCalls===1,'copied principal fields cannot select internal passwordless path');
await rejected(()=>replayService.uploadFromBrowser('', 'site','OUTBOUND','SHIP',file),'missing idempotency key rejected before transaction');
await rejected(()=>replayService.uploadFromBrowser('0123456789abcdef','site','SIDEWAYS','SHIP',file),'invalid shipment direction rejected before transaction');
const unmodified=Object.create(service.prototype);
await rejected(()=>unmodified.validatePdf(undefined),'missing PDF rejected');
await rejected(()=>unmodified.validatePdf({...file,buffer:Buffer.from('not a pdf')}),'invalid PDF rejected');
await rejected(()=>unmodified.validatePdf({...file,buffer:Buffer.alloc(25*1024*1024+1)}),'oversized PDF rejected');
// Protected operator guard is loaded from the unmodified implementation.
const AccessGuard=load(accessAuth+'truck-log-access.guard.ts').TruckLogAccessGuard;
const fakeSecret='1'.repeat(64), inactive={...principal,active:false,revokedAt:new Date(),expiresAt:null,secretSha256:require('node:crypto').createHash('sha256').update(fakeSecret).digest('hex')};
const access=new AccessGuard({findOne:async()=>inactive},{getAllAndOverride:()=>[]});
await rejected(()=>access.canActivate({switchToHttp:()=>({getRequest:()=>({headers:{authorization:`Bearer tloa_${principal.keyId}_${fakeSecret}`}})})}),'reserved inactive actor cannot authenticate even with matching digest');
const Api=load(apiPath).TruckLogApi, posts=[];
const api=new Api({post:(...args)=>{posts.push(args);return 'observable';}});
const browserFile=new File(['%PDF-1.4\n%%EOF\n'],'delivery.pdf',{type:'application/pdf',lastModified:123});
check(api.uploadRxoDriverDocumentFromBrowser('site name','INBOUND','SHIP / 1',browserFile,'0123456789abcdef')==='observable','browser API returns upload observable');
const [url,form,opts]=posts[0];
check(url==='/api/v1/rxo-documents/site%20name/INBOUND/SHIP%20%2F%201/browser-upload','API URL preserves and encodes shipment identity');
check([...form.keys()].join(',')==='file'&&form.get('file').name==='delivery.pdf','multipart request contains exactly one PDF and no user-supplied role');
check(opts.headers.get('authorization')===null&&opts.headers.get('x-truck-log-upload')==='browser-v1'&&opts.headers.get('x-idempotency-key')==='0123456789abcdef','no password, bearer credential or stored secret sent by browser API');
api.uploadRxoDriverDocument('site','OUTBOUND','SHIP',browserFile,'operator-test-token','0123456789abcdef');
check(posts[1][2].headers.get('authorization')==='Bearer operator-test-token','separate authenticated integration method retained');
const Component=load(componentPath).RxoDataStore, uploads=[],notifications=[],browserApi={newIdempotencyKey:()=> 'new-key-0123456789',uploadRxoDriverDocumentFromBrowser:(...args)=>({subscribe:handlers=>uploads.push({args,handlers})})};
const c=new Component(browserApi,{error:(...x)=>notifications.push(['error',...x]),success:(...x)=>notifications.push(['success',...x])});
let refreshes=0;c.loadData=()=>refreshes++;
const shipment={site_key:'site name',direction:'INBOUND',shipment_id:'SHIP / 1'}, input={files:[browserFile],value:'selected',click(){this.clicked=true;}};
c.beginRxoDocumentUpload(shipment,input);check(input.clicked&&input.value===''&&c.documentUploadTarget===shipment,'Upload PDF opens picker for selected row');
await c.uploadRxoDriverDocument({target:input});
check(uploads.length===1&&uploads[0].args.length===5&&uploads[0].args[0]===shipment.site_key&&uploads[0].args[2]===shipment.shipment_id,'real component uploads selected PDF with no token argument or prompt');
check(!!c.documentUploadingKey,'upload button remains locked while request runs');
await c.uploadRxoDriverDocument({target:input});check(uploads.length===1,'duplicate click cannot start a second upload');
uploads[0].handlers.error({status:0,error:{message:'offline'}});
const retryKey=c.pendingDocumentUploadKey;c.beginRxoDocumentUpload(shipment,input);await c.uploadRxoDriverDocument({target:input});
check(uploads.length===2&&uploads[1].args[4]===retryKey,'retry after network failure uses same idempotency key');
uploads[1].handlers.next({fileName:'delivery.pdf',version:1});
check(!c.documentUploadingKey&&!c.pendingDocumentUploadKey&&refreshes===1,'success clears lock/key and refreshes shipment documents');
componentWindow.confirm=()=>false;
const ready={...shipment,driverDocument:{status:'READY',documentId:7,version:1}};
c.beginRxoDocumentUpload(ready,input);await c.uploadRxoDriverDocument({target:input});
check(uploads.length===2&&!c.documentUploadTarget,'cancel replacement preserves active PDF');
componentWindow.confirm=()=>true;
c.beginRxoDocumentUpload(shipment,input);input.files=[new File(['bad'],'bad.txt',{type:'text/plain'})];await c.uploadRxoDriverDocument({target:input});
check(uploads.length===2&&notifications.at(-1)[0]==='error'&&!c.documentUploadingKey,'bad file rejected in browser without credential prompt');
c.beginRxoDocumentUpload(shipment,input);input.files=[];await c.uploadRxoDriverDocument({target:input});check(uploads.length===2,'cancelled picker creates no request');
const src=read(componentPath)+'\n'+read('libs/truck-log/web/feature/rxo-control-center/src/lib/rxo-data-table.component.html'), controller=read(rxoDocuments+'rxo-documents.controller.ts'), css=read('libs/truck-log/web/styles/src/styles/rxo.css');
check(!src.includes('materialsAccessToken')&&!src.includes('materialsTokenSessionKey')&&!src.includes('clearMaterialsAccessToken'),'obsolete Materials password/session helper removed');
check(src.includes('class="tl-rxo-document"')&&src.includes('row.driverDocument?.fileName')&&src.includes('[attr.aria-label]="(data.hasRxoDriverDocument(row)'),'stacked document control has filename and accessible action');
check(src.includes('class="tl-rxo-document"')&&/\.tl-rxo-document\s*\{[^}]*flex-wrap:\s*wrap/.test(css)&&src.includes('class="dana-cell-sub" *ngIf="row.driverDocument?.fileName"'),'document cell keeps status, button and filename readable and wrapping');
check((controller.match(/@UseGuards\(TruckLogAccessGuard\)/g)||[]).length===3&&controller.includes('@UseGuards(RxoBrowserUploadGuard)'),'three protected document handlers retain original access guard');
check(controller.includes('limits: { files: 1, fields: 0, fileSize: MAX_RXO_PDF_BYTES }'),'browser route retains one-file/no-extra-fields/25 MiB interceptor limits');
check(read(rxoDocuments+'rxo-documents.module.ts').includes('RxoBrowserUploadGuard'),'browser guard registered in existing module');
console.log(`[SUMMARY] ${checks} source/isolated-runtime checks passed. Live DB, Angular rendering and deployed HTTP are not exercised by this suite.`);
