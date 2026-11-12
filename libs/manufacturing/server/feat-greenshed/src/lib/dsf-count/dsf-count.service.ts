/* DSF (Digital Shop Floor) count reader for all configured physical machines except Lapper machines.
 *
 * The API PULLS from the DSF PostgreSQL source on a serialized poll; nothing pushes to us.
 * The source session is read-only (transaction, role policy and fixed SELECTs), and it is
 * closed before any MeshForge write happens. Everything here is off unless
 * DSF_COUNT_ENABLED=true, and counts only reach cutter runs when DSF_CUTTER_WRITE_ENABLED=true.
 * Restored from the earlier integration; see docs/manufacturing/DSF_COUNTS.md.
 */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readFileSync } from 'node:fs';
import { DsfCache, DsfCountRow, DsfState, DsfRefusal, timestampUs, chooseShift,
  replacementStart, reconcileRows, safeCountRow } from './dsf-core';
import { DSF_MAPPINGS } from './dsf-mappings';
import { applyDsfCutterCounts, CutterAttributionResult } from './dsf-cutter-attribution';
import { DANA_MACHINES_SQL, DANA_MACHINES_NO_LAPPER_SCHEMA_SQL, LAPPER_MACHINES_TABLE_SQL, SOURCE_IDENTITY_SQL, ROLE_CHECK_SQL, MAPPING_SQL, SHIFTS_SQL, CYCLES_SQL, OTHER_MAPPING_ACTIVITY_SQL } from './dsf-sql';
import { grinderStateRows, collectGrinderBatches, commitGrinderBatches, GrinderBatch, GrinderStateRow } from './dsf-grinder-balance';
import { ensureDsfCutterSchema } from './dsf-schema';
import { findUniqueMatches, UniqueMatchResult } from './dsf-unique-matches';
import { findRoughMatches, RoughMatchResult } from './dsf-rough-matches';

type Machine = {machine_id:string;machine_number:string;department:string;machine_type:string;active:boolean};
type QueryRunnerLike = {query(text:string,values?:unknown[]):Promise<any[]>};
/** The machines DSF counts cover: every MeshForge machine except Lapper machines. */
async function readDsfMachines(runner:QueryRunnerLike):Promise<Machine[]> {
  const lapper=(await runner.query(LAPPER_MACHINES_TABLE_SQL))[0];
  return runner.query(lapper?.present===true?DANA_MACHINES_SQL:DANA_MACHINES_NO_LAPPER_SCHEMA_SQL);
}
type SourceClient = { connect():Promise<void>;query(text:string,values?:unknown[]):Promise<{rows:any[]}>;end():Promise<void>;on(event:string,fn:(e:unknown)=>void):void; };
interface Config { enabled:boolean; valid:boolean; interval:number; machines:Set<string>; client:Record<string,unknown>; privilegedAccountAcknowledged?:boolean;
  /** DSF department names (normalised, see dsfDepartmentKey) that stand for a MeshForge department code. */
  departmentNames?:ReadonlyMap<string,string>;
  /** Why an enabled reader is not running: names the setting, never its value. */ problem?:string; }

type SourceOption = {
  mapping_id:string; whiteboard_id:string; op_id:string; line_id:string; department_id:string;
  department:string; department_name?:string; line_name:string; whiteboard_name:string; mapping_active:boolean;
  whiteboard_active:boolean; operation_line_matches:boolean; active_mappings:number; running_reasons:number;
};
type MappingOverride = {
  machine_id:string; mapping_id:string|null; whiteboard_id:string|null; op_id:string|null; line_id:string|null;
  department_id:string|null; source_department:string|null; line_name:string|null; whiteboard_name:string|null;
  enabled:boolean; revision:number;
};
type EffectiveMapping = {
  mapping_id:string; whiteboard_id:string; op_id:string; line_id:string; department_id:string;
  department:string; line_name:string; whiteboard_name:string; manual:boolean; blocked:string|null;
  known_mapping_ids:readonly string[]; other_mappings:readonly {mapping_id:string;whiteboard_id:string}[];
};
const MAPPING_OVERRIDE_SQL = `SELECT machine_id::text,mapping_id::text,whiteboard_id::text,op_id::text,line_id::text,
 department_id::text,source_department,line_name,whiteboard_name,enabled,revision
 FROM public.dana_dsf_machine_mapping_v1`;
const SOURCE_OPTIONS_SQL = `SELECT wm.id::text AS mapping_id,wm.whiteboard_id::text,wm.op_id::text,wm.line_id::text,
 l.department_id::text AS department_id,
 substring(d.name from '^Dept\\.\\s*([0-9]+)$') AS department,btrim(d.name) AS department_name,
 btrim(l.name) AS line_name,btrim(w.name) AS whiteboard_name,wm.active AS mapping_active,w.active AS whiteboard_active,
 (o.line_id=wm.line_id) AS operation_line_matches,
 (SELECT count(*)::int FROM public.tbl_whiteboard_machines x WHERE x.op_id=wm.op_id AND x.active) AS active_mappings,
 (SELECT count(*)::int FROM public.tbl_op_state_reason r WHERE r.op_id=wm.op_id AND r.code::text='1') AS running_reasons
 FROM public.tbl_whiteboard_machines wm JOIN public.tbl_whiteboard w ON w.id=wm.whiteboard_id
 JOIN public.tbl_op o ON o.id=wm.op_id JOIN public.tbl_line l ON l.id=wm.line_id
 LEFT JOIN public.tbl_department d ON d.id=l.department_id
 WHERE d.name ~ '^Dept\\.\\s*[0-9]+$' OR regexp_replace(upper(btrim(d.name)),'\\s+',' ','g') = ANY($1::text[])
 ORDER BY department,whiteboard_name,mapping_id LIMIT 5001`;

/**
 * DSF departments are named "Dept. 132"; a few use a plain name instead ("CUTTER GRIND" is
 * Department 45, the CutGrind grinders). DSF_DEPARTMENT_NAMES lists those as NAME=code pairs.
 */
export const DSF_DEFAULT_DEPARTMENT_NAMES = 'CUTTER GRIND=45';
export function dsfDepartmentKey(name:string):string { return String(name??'').trim().replace(/\s+/g,' ').toUpperCase(); }
export function parseDsfDepartmentNames(value:string|undefined):Map<string,string>|null {
  const text=(value??'').trim()||DSF_DEFAULT_DEPARTMENT_NAMES;
  const out=new Map<string,string>();
  for(const entry of text.split(',').map(x=>x.trim()).filter(Boolean)) {
    const match=/^([^=]{1,60})=\s*([0-9]{1,10})$/.exec(entry);
    const key=match?dsfDepartmentKey(match[1]):'';
    if(!match||!key||/^DEPT\./.test(key)||out.has(key))return null;
    out.set(key,match[2]);
  }
  return out.size<=50?out:null;
}
/** The MeshForge department code a DSF department name stands for, or null. */
export function dsfDepartmentCode(name:string|null|undefined,names:ReadonlyMap<string,string>):string|null {
  const text=String(name??'').trim();
  return /^Dept\.\s*([0-9]+)$/.exec(text)?.[1] ?? names.get(dsfDepartmentKey(text)) ?? null;
}

// DSFCONNECT2: a user-approved exception, NOT removal of source/readonly/mapping guards.
export const DSF_PRIVILEGED_ACK = 'TEMPORARY_APP_READ_ONLY_ACCEPTED';
// The only source and logins the acknowledgment is accepted for. 'whiteboard' is the DSF
// application's own login and can write to DSF; MeshForge relies on its read-only session.
const DSF_ACK_LOGINS:readonly string[] = ['dana_dsf_reader','whiteboard'];
const dsfAckSource = (host:unknown,database:unknown,user:unknown):boolean =>
  host==='10.16.80.10' && database==='maindblocal' && typeof user==='string' && DSF_ACK_LOGINS.includes(user);
export const DSF_ACCOUNT_SQL = `SELECT current_database()::text AS database_name,
 session_user::text AS session_login,current_user::text AS effective_login,
 current_setting('transaction_read_only')='on' AS read_only`;
export function dsfAccountPolicy(config:Config,account:any,rights:any):string {
  if(!account || account.database_name!==config.client['database'] ||
     account.session_login!==config.client['user'] || account.effective_login!==account.session_login ||
     account.read_only!==true || rights?.can_read!==true)throw new DsfRefusal('SOURCE_ACCOUNT_MISMATCH');
  if(rights.role_safe===true && rights.no_database_create===true && rights.no_schema_create===true && rights.no_source_writes===true)
    return 'RESTRICTED_ROLE_CHECKS_PASSED';
  if(config.privilegedAccountAcknowledged===true && dsfAckSource(config.client['host'],config.client['database'],config.client['user']))
    return 'USER_APPROVED_PRIVILEGED_ACCOUNT_APP_READ_ONLY';
  throw new DsfRefusal('READ_ONLY_ROLE_REQUIRED');
}
/**
 * Reads the DSF_* settings. When DSF is enabled but the settings cannot be used, `problem` says
 * which setting is wrong (never its value), so Admin > DSF Mappings and the start-up log can say so.
 */
export function readDsfConfig(env:NodeJS.ProcessEnv): Config {
  const enabled=env['DSF_COUNT_ENABLED']==='true';
  const integer=(key:string,def:number,min:number,max:number)=>{
    const v=env[key]; if(v===undefined||v==='')return def;
    if(!/^\d+$/.test(v))return NaN;
    const n=Number(v);return n>=min&&n<=max?n:NaN;
  };
  const interval=integer('DSF_COUNT_INTERVAL_SECONDS',60,30,3600);
  const departmentNames=parseDsfDepartmentNames(env['DSF_DEPARTMENT_NAMES']);
  const off=(problem?:string):Config=>({enabled,valid:false,interval:Number.isFinite(interval)?interval:60,machines:new Set<string>(),client:{},
    departmentNames:departmentNames??new Map(),...(problem?{problem}:{})});
  if(!enabled)return off(); // Do not read secret files or construct a client while disabled.
  const host=env['DSF_DB_HOST']?.trim(),database=env['DSF_DB_NAME']?.trim(),user=env['DSF_DB_USER']?.trim();
  const port=integer('DSF_DB_PORT',5432,1,65535);
  const acknowledgment=env['DSF_PRIVILEGED_READER_ACK'];
  const privilegedAccountAcknowledged=acknowledgment===DSF_PRIVILEGED_ACK;
  if(acknowledgment && !privilegedAccountAcknowledged)
    return off('DSF_PRIVILEGED_READER_ACK is set but is not the exact acknowledgment text; clear it or see DSF_COUNTS.md.');
  if(acknowledgment && !dsfAckSource(host,database,user))
    return off('DSF_PRIVILEGED_READER_ACK is only accepted for the recorded plant source (host 10.16.80.10, database maindblocal, login dana_dsf_reader or whiteboard); clear it for any other source.');
  const machineValues=(env['DSF_COUNT_MACHINES']||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!host)return off('DSF_DB_HOST is empty.');
  if(!database)return off('DSF_DB_NAME is empty.');
  if(!user)return off('DSF_DB_USER is empty.');
  if(!Number.isFinite(port))return off('DSF_DB_PORT must be a whole number from 1 to 65535.');
  if(!Number.isFinite(interval))return off('DSF_COUNT_INTERVAL_SECONDS must be a whole number from 30 to 3600.');
  if(!departmentNames)
    return off('DSF_DEPARTMENT_NAMES must be DSF department names and MeshForge department numbers, like CUTTER GRIND=45, separated by commas.');
  if(machineValues.length>1000||machineValues.some(x=>!/^[A-Za-z0-9-]{1,20}$/.test(x))||new Set(machineValues).size!==machineValues.length)
    return off('DSF_COUNT_MACHINES must be distinct machine numbers separated by commas (or empty).');
  // Never inherit PG* defaults or fall back to the Dana Apps database credentials.
  if(host===env['DATABASE_HOST']&&database===env['DATABASE_NAME'])
    return off('DSF_DB_HOST and DSF_DB_NAME point at the MeshForge database itself, not DSF.');
  let password=env['DSF_DB_PASSWORD'];
  let reading='DSF_DB_PASSWORD_FILE';
  try {
    if(env['DSF_DB_PASSWORD_FILE']) {
      if(password)return off('Set DSF_DB_PASSWORD or DSF_DB_PASSWORD_FILE, not both.');
      password=readFileSync(env['DSF_DB_PASSWORD_FILE'],'utf8').replace(/\r?\n$/,'');
    }
    if(!password)return off(env['DSF_DB_PASSWORD_FILE']?'DSF_DB_PASSWORD_FILE is empty.':'DSF_DB_PASSWORD is empty.');
    const mode=env['DSF_DB_SSL_MODE']||'verify-full';
    if(!['verify-full','disable'].includes(mode))return off('DSF_DB_SSL_MODE must be verify-full or disable.');
    let ssl:unknown=false;
    if(mode==='verify-full') {
      if(env['DSF_DB_SSL_CA_FILE'] && env['DSF_DB_SSL_CA_PEM'])return off('Set DSF_DB_SSL_CA_FILE or DSF_DB_SSL_CA_PEM, not both.');
      reading='DSF_DB_SSL_CA_FILE';
      const ca=env['DSF_DB_SSL_CA_PEM'] || (env['DSF_DB_SSL_CA_FILE']?readFileSync(env['DSF_DB_SSL_CA_FILE'],'utf8'):undefined);
      const caKey=env['DSF_DB_SSL_CA_PEM']?'DSF_DB_SSL_CA_PEM':'DSF_DB_SSL_CA_FILE';
      if(ca && (!ca.includes('-----BEGIN CERTIFICATE-----') || /PRIVATE KEY/.test(ca) || ca.length>131072))
        return off(caKey+' must hold PEM certificate(s) (-----BEGIN CERTIFICATE-----) and no private key.');
      ssl={rejectUnauthorized:true,...(ca?{ca}:{})};
    }
    return {enabled:true,valid:true,interval,machines:new Set(machineValues),privilegedAccountAcknowledged,departmentNames,client:{
      host,port,database,user,password,ssl,application_name:'DanaApps-DSF-Count-V2',
      connectionTimeoutMillis:5000,query_timeout:7000,statement_timeout:5000,lock_timeout:1000,
      options:'-c default_transaction_read_only=on',keepAlive:true,
    }};
  } catch { return off(reading+' could not be read by the API process.'); }
}

/**
 * A short, secret-free code for a failed DSF connection or query. Driver and OS errors carry one
 * (ECONNREFUSED, 28P01, ...); a few `pg` and TLS failures only carry a message, so name those here.
 */
export function dsfFailureCode(e:unknown):string|null {
  const raw=(e as {code?:unknown}|null)?.code;
  if(typeof raw==='string'&&/^[A-Z0-9_]{2,40}$/.test(raw))return raw;
  const message=e instanceof Error?e.message:'';
  if(/does not support SSL/i.test(message))return 'SSL_NOT_SUPPORTED';
  if(/timeout expired|Connection terminated due to connection timeout/i.test(message))return 'CONNECT_TIMEOUT';
  if(/Query read timeout/i.test(message))return 'QUERY_TIMEOUT';
  if(/Connection terminated/i.test(message))return 'CONNECTION_TERMINATED';
  return null;
}

@Injectable()
export class DsfCountService implements OnModuleInit,OnModuleDestroy {
  private readonly config=readDsfConfig(process.env);
  private timer:ReturnType<typeof setTimeout>|null=null;
  private stopped=false; private busy=false; private failures=0;
  private source:SourceClient|null=null;
  private machines:Machine[]=[];
  private caches=new Map<string,DsfCache>();
  private states=new Map<string,{status:DsfState;note:string}>();
  private lastSuccess:string|null=null;
  private readerState:DsfState='NOT_CONFIGURED';
  private accountPolicy='NOT_CHECKED';
  private readonly writerEnabled=process.env['DSF_CUTTER_WRITE_ENABLED']==='true';
  private writerResults=new Map<string,CutterAttributionResult>();
  private sourceOptions:SourceOption[]=[];
  private sourceOptionsRefreshedAt:string|null=null;
  private mappingOverrides=new Map<string,MappingOverride>();
  private effectiveMappings=new Map<string,EffectiveMapping>();
  private mappingKeys=new Map<string,string>();
  private pendingImmediate=false;
  private nextImmediateAllowedAt=0;
  constructor(@InjectDataSource() private readonly db:DataSource) {}
  private readonly logger=new Logger('DsfCount');
  private lastFailure:{reason:string;code:string|null;at:string}|null=null;
  async onModuleInit():Promise<void> {
    if (this.db.options.type === 'postgres') this.machines = await readDsfMachines(this.db);
    if(!this.config.enabled)return;
    if(!this.config.valid) {
      // Enabled but unusable settings must be visible, not a silent "not configured".
      this.logger.warn('DSF_COUNT_ENABLED=true but the DSF reader is not running: '+(this.config.problem||'the DSF_* settings are incomplete or invalid.'));
      return;
    }
    try { await ensureDsfCutterSchema(this.db); }
    catch(e) {
      const code=dsfFailureCode(e);
      this.schemaProblem='The DSF tables could not be created in the MeshForge database'+(code?' ('+code+')':'')+'. Check the API log, then restart the API.';
      this.logger.error('DSF tables could not be prepared in the MeshForge database; the DSF reader is not running.'+(code?' ('+code+')':''));return;
    }
    this.schemaReady=true;this.readerState='WAITING';this.schedule(1000);
  }
  private schemaReady=false;
  private schemaProblem:string|null=null;
  private sourceOptionsProblem:{reason:string;code:string|null}|null=null;
  onModuleDestroy():void {
    this.stopped=true;if(this.timer)clearTimeout(this.timer);
    if(this.source)void this.source.end().catch(()=>undefined);
  }
  // After a committed setup/changeover, request one serialized DSF refresh.
  // Debounced to protect the production DSF server from repeated operations.
  requestImmediate(force=false):void {
    if ((!this.writerEnabled && !force) || !this.config.valid || !this.schemaReady || this.stopped) return;
    if (this.busy) {this.pendingImmediate=true;return;}
    const now=Date.now(), delay=Math.max(1000,this.nextImmediateAllowedAt-now);
    this.nextImmediateAllowedAt=now+15000;
    if(this.timer)clearTimeout(this.timer);
    this.schedule(delay);
  }
  private schedule(ms:number):void {
    if(this.stopped)return;
    this.timer=setTimeout(()=>{void this.poll();},ms);this.timer.unref?.();
  }
  private makeClient():SourceClient {
    // The same `pg` module TypeORM loaded for the MeshForge connection; a separate Client, never the app pool.
    const pg=(this.db.driver as unknown as {postgres?:{Client:new(config:Record<string,unknown>)=>SourceClient}}).postgres;
    if(!pg?.Client)throw new DsfRefusal('POSTGRES_DRIVER_UNAVAILABLE');
    return new pg.Client(this.config.client);
  }
  snapshot() {
    const now=new Date().toISOString();
    const rows:DsfCountRow[]=this.machines.map(m=>{
      const state=(!m.active ? {status:'INACTIVE' as DsfState,note:'Machine inactive in MeshForge'} : this.states.get(m.machine_id))||{status:(this.config.enabled ? 'WAITING' : 'NOT_CONFIGURED') as DsfState,note:this.config.enabled ? 'Waiting for first DSF read' : 'DSF is not enabled'};
      return safeCountRow(m,this.caches.get(m.machine_id),state.status,state.note,now,this.config.interval*2+30);
    });
    return {format:'DSFCOUNT1',scope:'PHYSICAL_MACHINE_CURRENT_SHIFT',status:this.readerState,
      interval_seconds:this.config.interval,last_success_at:this.lastSuccess,served_at:now,
      configured:this.config.valid,counts_are_comparison_only:!this.writerEnabled,connection_setup_version:'DSFCONNECT2',account_policy:this.accountPolicy,
      cutter_write_enabled:this.writerEnabled,
      cutter_attribution_status:rows.map(r=>({machine_id:r.machine_id,
        status:this.writerResults.get(r.machine_id)?.status||'NOT_APPLIED',
        reason:this.writerResults.get(r.machine_id)?.reason||'NO_FRESH_WRITE'})),rows};
  }
  private uuid(value:unknown):value is string { return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
  private effectiveFor(machine:Machine,override:MappingOverride|undefined):EffectiveMapping|null {
    if(override) {
      if(!override.enabled || !override.mapping_id || override.source_department !== machine.department) return null;
      if(!this.uuid(override.mapping_id)||!this.uuid(override.whiteboard_id)||!this.uuid(override.op_id)||
         !this.uuid(override.line_id)||!this.uuid(override.department_id)||!override.source_department||
         !override.line_name||!override.whiteboard_name) return null;
      return {mapping_id:override.mapping_id,whiteboard_id:override.whiteboard_id,op_id:override.op_id,
        line_id:override.line_id,department_id:override.department_id,department:override.source_department,
        line_name:override.line_name,whiteboard_name:override.whiteboard_name,manual:true,blocked:null,
        known_mapping_ids:[override.mapping_id],other_mappings:[]};
    }
    const ref=DSF_MAPPINGS.find(x=>x.machine_number===machine.machine_number&&x.department===machine.department);
    if(!ref)return null;
    return {...ref,manual:false};
  }
  private async loadOverrides(runner:QueryRunnerLike):Promise<Map<string,MappingOverride>> {
    const rows=await runner.query(MAPPING_OVERRIDE_SQL) as MappingOverride[];
    if(rows.length>1000)throw new DsfRefusal('MAPPING_OVERRIDE_LIMIT');
    const out=new Map<string,MappingOverride>();
    for(const row of rows) {
      if(!this.uuid(row.machine_id)||out.has(row.machine_id))throw new DsfRefusal('MAPPING_OVERRIDE_INVALID');
      out.set(row.machine_id,row);
    }
    return out;
  }
  private mappingKey(mapping:EffectiveMapping):string { return [mapping.mapping_id,mapping.whiteboard_id,mapping.op_id,mapping.line_id].join('|'); }
  private invalidateMachine(machineId:string):void {
    this.caches.delete(machineId);this.states.set(machineId,{status:'WAITING',note:'Mapping changed; waiting for fresh DSF read'});
    this.writerResults.delete(machineId);this.mappingKeys.delete(machineId);this.effectiveMappings.delete(machineId);
    this.requestImmediate(true);
  }
  private catalogReadAt = 0;
  async currentSnapshot() {
    if (this.db.options.type === 'postgres' && Date.now() - this.catalogReadAt > 30000) {
      this.machines = await readDsfMachines(this.db);
      this.catalogReadAt = Date.now();
    }
    return this.snapshot();
  }

  async adminSnapshot() {
    if (this.db.options.type === 'postgres') this.machines = await readDsfMachines(this.db);
    const live=this.snapshot();
    const assigned=new Map<string,string>();
    for(const machine of this.machines) {
      const mapping=this.effectiveFor(machine,this.mappingOverrides.get(machine.machine_id));
      if(mapping)assigned.set(mapping.mapping_id,machine.machine_id);
    }
    return {format:'DSFMAPADMIN1',status:live.status,configured:live.configured,interval_seconds:live.interval_seconds,
      last_success_at:live.last_success_at,served_at:live.served_at,cutter_write_enabled:live.cutter_write_enabled,
      enabled:this.config.enabled,last_failure:this.lastFailure,account_policy:live.account_policy,
      config_problem:this.config.enabled?(this.config.problem||this.schemaProblem):null,
      source_options_problem:this.sourceOptionsProblem,
      source_options_status:this.sourceOptions.length?'READY':'WAITING',source_options_refreshed_at:this.sourceOptionsRefreshedAt,
      source_options:this.sourceOptions.map(option=>({...option,assigned_machine_id:assigned.get(option.mapping_id)||null})),
      rows:live.rows.map(row=>{
        const machine=this.machines.find(x=>x.machine_id===row.machine_id);
        const override=this.mappingOverrides.get(row.machine_id);const mapping=machine?this.effectiveFor(machine,override):null;
        const writer=this.writerResults.get(row.machine_id);
        return {...row,active:machine?.active===true,mapping_origin:override?(override.enabled&&override.mapping_id?'ADMIN':'UNMAPPED'):(mapping?'REFERENCE':'NONE'),
          mapping:mapping?{mapping_id:mapping.mapping_id,whiteboard_id:mapping.whiteboard_id,op_id:mapping.op_id,
            line_id:mapping.line_id,department_id:mapping.department_id,line_name:mapping.line_name,
            whiteboard_name:mapping.whiteboard_name,manual:mapping.manual,blocked:mapping.blocked}:null,
          writer_status:writer?.status||'NOT_APPLIED',writer_reason:writer?.reason||'NO_FRESH_WRITE'};
      })};
  }
  async saveAdminMapping(machineId:string,mappingId:string,userId:string) {
    if(!this.uuid(machineId)||!this.uuid(mappingId)||!this.uuid(userId))throw new BadRequestException('Invalid mapping request.');
    this.requireFreshSources();
    const option=this.sourceOptions.find(x=>x.mapping_id===mappingId);
    if(!option)throw new BadRequestException('Selected DSF source is not in the current source list.');
    if(!option.mapping_active||!option.whiteboard_active||!option.operation_line_matches||option.running_reasons<1)
      throw new BadRequestException('Selected DSF source is not currently eligible.');
    let saved:MappingOverride|null=null;
    await this.db.transaction(async manager=>{
      await manager.query("SET LOCAL lock_timeout='2s'");await manager.query("SET LOCAL statement_timeout='8s'");
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('dana-dsf-mapping-admin-v1'))");
      const machineRows=await manager.query(`SELECT m.id::text AS machine_id,btrim(m.machine_number) AS machine_number,d.code AS department,
        (m.active AND m.enabled AND d.active AND d.enabled) AS active FROM public.machines m JOIN public.departments d ON d.id=m.department_id
        WHERE m.id=$1::uuid AND m."deletedAt" IS NULL AND d."deletedAt" IS NULL
        FOR UPDATE OF m`,[machineId]) as Machine[];
      if(machineRows.length!==1)throw new NotFoundException('Machine was not found.');
      const machine=machineRows[0];
      const allMachines=await readDsfMachines(manager);
      if(!allMachines.some(x=>x.machine_id===machineId))throw new BadRequestException('Lapper machines do not use DSF counts.');
      if(option.department!==machine.department)throw new BadRequestException('Selected DSF source belongs to a different department.');
      const overrideRows=await manager.query(MAPPING_OVERRIDE_SQL) as MappingOverride[];
      const overrideMap=new Map(overrideRows.map(row=>[row.machine_id,row]));
      for(const other of allMachines) {
        if(other.machine_id===machineId)continue;
        const effective=this.effectiveFor(other,overrideMap.get(other.machine_id));
        if(effective?.mapping_id===mappingId)throw new ConflictException('That DSF source is already assigned to another machine.');
      }
      const existingOverride=overrideMap.get(machineId);const prior=this.effectiveFor(machine,existingOverride);
      const ready=(await manager.query(`SELECT to_regclass('public.dana_dsf_cutter_machine_state_v1') IS NOT NULL AS a,
        to_regclass('public.dana_dsf_cutter_run_shifts_v1') IS NOT NULL AS b`))[0];
      if(ready?.a&&ready?.b) {
        const history=(await manager.query(`SELECT EXISTS(SELECT 1 FROM public.dana_dsf_cutter_machine_state_v1 WHERE machine_id=$1::uuid)
          OR EXISTS(SELECT 1 FROM public.dana_dsf_cutter_run_shifts_v1 WHERE machine_id=$1::uuid) AS has_history`,[machineId]))[0];
        if(history?.has_history===true) {
          let protectedMapping=prior?.mapping_id||null;
          if(!protectedMapping && existingOverride && !existingOverride.enabled) {
            const audit=await manager.query(`SELECT COALESCE(new_mapping_id,previous_mapping_id)::text AS mapping_id
              FROM public.dana_dsf_machine_mapping_audit_v1 WHERE machine_id=$1::uuid
              AND (new_mapping_id IS NOT NULL OR previous_mapping_id IS NOT NULL) ORDER BY changed_at DESC,id DESC LIMIT 1`,[machineId]);
            protectedMapping=audit[0]?.mapping_id||null;
          }
          if(!protectedMapping || protectedMapping!==mappingId)
            throw new ConflictException('This machine already has DSF cutter attribution history. You can re-enable its same source, but changing to a different DSF source requires a reviewed attribution reset.');
        }
      }
      const rows=await manager.query(`INSERT INTO public.dana_dsf_machine_mapping_v1
        (machine_id,mapping_id,whiteboard_id,op_id,line_id,department_id,source_department,line_name,whiteboard_name,enabled,revision,approved_by,approved_at,updated_at)
        VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,true,1,$10::uuid,clock_timestamp(),clock_timestamp())
        ON CONFLICT(machine_id) DO UPDATE SET mapping_id=EXCLUDED.mapping_id,whiteboard_id=EXCLUDED.whiteboard_id,op_id=EXCLUDED.op_id,
          line_id=EXCLUDED.line_id,department_id=EXCLUDED.department_id,source_department=EXCLUDED.source_department,line_name=EXCLUDED.line_name,
          whiteboard_name=EXCLUDED.whiteboard_name,enabled=true,revision=public.dana_dsf_machine_mapping_v1.revision+1,
          approved_by=EXCLUDED.approved_by,approved_at=clock_timestamp(),updated_at=clock_timestamp()
        RETURNING machine_id::text,mapping_id::text,whiteboard_id::text,op_id::text,line_id::text,department_id::text,
          source_department,line_name,whiteboard_name,enabled,revision`,
        [machineId,option.mapping_id,option.whiteboard_id,option.op_id,option.line_id,option.department_id,option.department,
         option.line_name,option.whiteboard_name,userId]) as MappingOverride[];
      if(rows.length!==1)throw new ConflictException('Mapping save did not complete.');
      saved=rows[0];
      await manager.query(`INSERT INTO public.dana_dsf_machine_mapping_audit_v1
        (machine_id,action,previous_mapping_id,new_mapping_id,changed_by,source_snapshot)
        VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::jsonb)`,
        [machineId,prior?'REMAP':'MAP',prior?.mapping_id||null,mappingId,userId,JSON.stringify(option)]);
    });
    if(!saved)throw new ConflictException('Mapping save did not complete.');
    this.mappingOverrides.set(machineId,saved);this.invalidateMachine(machineId);
    return {status:'SAVED',machine_id:machineId,mapping_id:mappingId,refresh_requested:true};
  }
  /** What both match previews need: Admin decisions, the source each machine uses, and crediting history. */
  private async matchContext() {
    this.requireFreshSources();
    if (this.db.options.type === 'postgres') this.machines = await readDsfMachines(this.db);
    const overrides=await this.loadOverrides(this.db);
    const assigned=new Map<string,string>();
    const current=new Map<string,{mapping_id:string;whiteboard_name:string;line_name:string}>();
    const leftUnmapped=new Set<string>();
    for(const machine of this.machines) {
      const override=overrides.get(machine.machine_id);
      const mapping=this.effectiveFor(machine,override);
      if(mapping)assigned.set(mapping.mapping_id,machine.machine_id);
      if(mapping&&!mapping.blocked)current.set(machine.machine_id,{mapping_id:mapping.mapping_id,whiteboard_name:mapping.whiteboard_name,line_name:mapping.line_name});
      else if(override&&!(override.enabled&&override.mapping_id))leftUnmapped.add(machine.machine_id);
    }
    const history=await this.db.query(`SELECT machine_id::text FROM public.dana_dsf_cutter_machine_state_v1
      UNION SELECT machine_id::text FROM public.dana_dsf_cutter_run_shifts_v1`) as {machine_id:string}[];
    return {overrides,assigned,current,leftUnmapped,withHistory:new Set(history.map(row=>row.machine_id))};
  }
  /** DSF sources that match exactly one machine by department and the machine number their whiteboard name ends in. */
  async uniqueMatches():Promise<UniqueMatchResult & {source_options_refreshed_at:string|null}> {
    const context=await this.matchContext();
    const result=findUniqueMatches({machines:this.machines,sources:this.sourceOptions,adminDecided:new Set(context.overrides.keys()),
      assigned:context.assigned,withHistory:context.withHistory});
    return {...result,source_options_refreshed_at:this.sourceOptionsRefreshedAt};
  }
  /**
   * Saves the matches an administrator confirmed. Each pair is checked again against the current
   * unique matches, then saved through the normal Admin save (its own transaction, checks and audit).
   */
  async applyUniqueMatches(pairs:unknown,userId:string) {
    const wanted=this.confirmedPairs(pairs);
    const current=await this.uniqueMatches();
    return this.saveConfirmedPairs(wanted,userId,pair=>{
      const match=current.matches.find(m=>m.machine_id===pair.machine_id);
      return match&&match.mapping_id===pair.mapping_id?match:{machine_number:match?.machine_number??null,reason:'No longer the only match. Refresh and try again.'};
    });
  }
  /** Every DSF source and every active machine, paired loosely by machine number. Changes nothing. */
  async roughMatches():Promise<RoughMatchResult & {source_options_refreshed_at:string|null}> {
    const context=await this.matchContext();
    const result=findRoughMatches({machines:this.machines,sources:this.sourceOptions,current:context.current,
      leftUnmapped:context.leftUnmapped,assigned:context.assigned,withHistory:context.withHistory});
    return {...result,source_options_refreshed_at:this.sourceOptionsRefreshedAt};
  }
  /**
   * Saves the rough matches an administrator picked. Each pair must still be one of that machine's
   * candidates, then it is saved through the normal Admin save (its own transaction, checks and audit).
   */
  async applyRoughMatches(pairs:unknown,userId:string) {
    const wanted=this.confirmedPairs(pairs);
    if(new Set(wanted.map(pair=>pair.mapping_id)).size!==wanted.length)throw new BadRequestException('A DSF source is chosen for more than one machine.');
    const current=await this.roughMatches();
    return this.saveConfirmedPairs(wanted,userId,pair=>{
      const machine=current.machines.find(m=>m.machine_id===pair.machine_id);
      const candidate=machine&&['PROPOSED','CHOOSE'].includes(machine.status)?machine.candidates.find(c=>c.mapping_id===pair.mapping_id):undefined;
      return machine&&candidate?{machine_number:machine.machine_number,whiteboard_name:candidate.whiteboard_name}
        :{machine_number:machine?.machine_number??null,reason:'No longer a match for this machine. Refresh and try again.'};
    });
  }
  private confirmedPairs(pairs:unknown):{machine_id:string;mapping_id:string}[] {
    if(!Array.isArray(pairs)||pairs.length===0||pairs.length>1000)throw new BadRequestException('Send the matches to map.');
    const wanted=pairs.map(pair=>({machine_id:String((pair as {machine_id?:unknown})?.machine_id||''),mapping_id:String((pair as {mapping_id?:unknown})?.mapping_id||'')}));
    if(wanted.some(pair=>!this.uuid(pair.machine_id)||!this.uuid(pair.mapping_id)))throw new BadRequestException('Invalid match.');
    if(new Set(wanted.map(pair=>pair.machine_id)).size!==wanted.length)throw new BadRequestException('A machine is listed twice.');
    return wanted;
  }
  /** Saves each still-valid pair through the normal Admin save; reports the rest. */
  private async saveConfirmedPairs(wanted:{machine_id:string;mapping_id:string}[],userId:string,
    check:(pair:{machine_id:string;mapping_id:string})=>{machine_number:string;whiteboard_name:string}|{machine_number:string|null;reason:string}) {
    const mapped:{machine_id:string;machine_number:string;whiteboard_name:string}[]=[];
    const skipped:{machine_id:string;machine_number:string|null;reason:string}[]=[];
    for(const pair of wanted) {
      const ok=check(pair);
      if('reason' in ok) { skipped.push({machine_id:pair.machine_id,machine_number:ok.machine_number,reason:ok.reason});continue; }
      try {
        await this.saveAdminMapping(pair.machine_id,pair.mapping_id,userId);
        mapped.push({machine_id:pair.machine_id,machine_number:ok.machine_number,whiteboard_name:ok.whiteboard_name});
      } catch(e) {
        const message=(e as {message?:unknown})?.message;
        skipped.push({machine_id:pair.machine_id,machine_number:ok.machine_number,
          reason:typeof message==='string'&&message.length<300?message:'Mapping save failed.'});
      }
    }
    return {status:'DONE',mapped,skipped};
  }
  private requireFreshSources():void {
    const refreshed=this.sourceOptionsRefreshedAt?Date.parse(this.sourceOptionsRefreshedAt):NaN;
    if(!Number.isFinite(refreshed)||Date.now()-refreshed>Math.max(600000,(this.config.interval*2+30)*1000))
      throw new ServiceUnavailableException('DSF source list is not fresh. Refresh status and try again.');
  }
  async unmapAdminMachine(machineId:string,userId:string) {
    if(!this.uuid(machineId)||!this.uuid(userId))throw new BadRequestException('Invalid unmap request.');
    let saved:MappingOverride|null=null;
    await this.db.transaction(async manager=>{
      await manager.query("SET LOCAL lock_timeout='2s'");await manager.query("SET LOCAL statement_timeout='8s'");
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('dana-dsf-mapping-admin-v1'))");
      const machineRows=await manager.query(`SELECT m.id::text AS machine_id,btrim(m.machine_number) AS machine_number,d.code AS department,
        (m.active AND m.enabled AND d.active AND d.enabled) AS active FROM public.machines m JOIN public.departments d ON d.id=m.department_id
        WHERE m.id=$1::uuid AND m."deletedAt" IS NULL AND d."deletedAt" IS NULL
        FOR UPDATE OF m`,[machineId]) as Machine[];
      if(machineRows.length!==1)throw new NotFoundException('Machine was not found.');
      const machine=machineRows[0];const existing=(await manager.query(MAPPING_OVERRIDE_SQL) as MappingOverride[]).find(x=>x.machine_id===machineId);
      const prior=this.effectiveFor(machine,existing);
      const rows=await manager.query(`INSERT INTO public.dana_dsf_machine_mapping_v1
        (machine_id,mapping_id,whiteboard_id,op_id,line_id,department_id,source_department,line_name,whiteboard_name,enabled,revision,approved_by,approved_at,updated_at)
        VALUES ($1::uuid,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,false,1,$2::uuid,clock_timestamp(),clock_timestamp())
        ON CONFLICT(machine_id) DO UPDATE SET mapping_id=NULL,whiteboard_id=NULL,op_id=NULL,line_id=NULL,department_id=NULL,
          source_department=NULL,line_name=NULL,whiteboard_name=NULL,enabled=false,revision=public.dana_dsf_machine_mapping_v1.revision+1,
          approved_by=EXCLUDED.approved_by,approved_at=clock_timestamp(),updated_at=clock_timestamp()
        RETURNING machine_id::text,mapping_id::text,whiteboard_id::text,op_id::text,line_id::text,department_id::text,
          source_department,line_name,whiteboard_name,enabled,revision`,[machineId,userId]) as MappingOverride[];
      saved=rows[0]||null;
      await manager.query(`INSERT INTO public.dana_dsf_machine_mapping_audit_v1
        (machine_id,action,previous_mapping_id,new_mapping_id,changed_by,source_snapshot)
        VALUES ($1::uuid,'UNMAP',$2::uuid,NULL,$3::uuid,NULL)`,[machineId,prior?.mapping_id||null,userId]);
    });
    if(!saved)throw new ConflictException('Unmap did not complete.');
    this.mappingOverrides.set(machineId,saved);this.invalidateMachine(machineId);
    return {status:'UNMAPPED',machine_id:machineId,refresh_requested:true};
  }

  private async poll():Promise<void> {
    if(this.busy||this.stopped||!this.config.valid||!this.schemaReady)return;
    this.busy=true;
    let lease:ReturnType<DataSource['createQueryRunner']>|null=null,held=false;
    let client:SourceClient|null=null,watchdog:ReturnType<typeof setTimeout>|null=null;
    try {
      // Shared local lease: a second API process cannot open a parallel source connection.
      lease=this.db.createQueryRunner();await lease.connect();
      const locks=await lease.query('SELECT pg_try_advisory_lock(1437329,77311) AS held');
      held=locks[0]?.held===true;
      if(!held)throw new DsfRefusal('READER_BUSY');
      const machines:Machine[]=await readDsfMachines(lease);
      if(machines.length>1000)throw new DsfRefusal('MACHINE_LIMIT');
      this.machines=machines;this.mappingOverrides=await this.loadOverrides(lease);
      const nextCaches=new Map(this.caches),nextStates=new Map<string,{status:DsfState;note:string}>();
      const nextMappingKeys=new Map<string,string>();
      const candidates:Array<{machine:Machine;mapping:EffectiveMapping}>=[];
      const effective=new Map<string,EffectiveMapping>();
      for(const m of machines) {
        const override=this.mappingOverrides.get(m.machine_id);const mapping=this.effectiveFor(m,override);
        if(mapping)effective.set(m.machine_id,mapping);
        if(!m.active)nextStates.set(m.machine_id,{status:'INACTIVE',note:'Machine inactive in MeshForge'});
        else if(override && (!override.enabled||!override.mapping_id)) {nextStates.set(m.machine_id,{status:'MAPPING_REVIEW',note:'No DSF source selected in Admin'});nextCaches.delete(m.machine_id);}
        else if(!mapping||(!mapping.manual&&mapping.blocked)||machines.filter(x=>x.machine_number===m.machine_number && x.department===m.department).length!==1) {
          nextStates.set(m.machine_id,{status:'MAPPING_REVIEW',note:mapping?.blocked||'Physical machine mapping not approved'});nextCaches.delete(m.machine_id);
        } else if(!mapping.manual&&!this.config.machines.has(m.machine_number))nextStates.set(m.machine_id,{status:'NOT_CONFIGURED',note:'Not enabled for DSF comparison'});
        else {
          const key=this.mappingKey(mapping);nextMappingKeys.set(m.machine_id,key);
          if(this.mappingKeys.get(m.machine_id)!==key){nextCaches.delete(m.machine_id);this.writerResults.delete(m.machine_id);}
          candidates.push({machine:m,mapping});nextStates.set(m.machine_id,this.states.get(m.machine_id)||{status:'WAITING',note:'Waiting for first DSF read'});
        }
      }
      this.effectiveMappings=effective;this.mappingKeys=nextMappingKeys;
      this.states=nextStates; // blocked/inactive/unmapped identities never retain a publishable old count
      // Grinder balances are independent of cutter mapping eligibility. Preserve a single
      // DSF reader even when no cutter machine currently has an approved source.
      // The CutGrind (Department 45) ledger belongs to features this codebase does not have, so
      // its tables normally do not exist here. Look before querying: no failing statement per poll.
      let grinderStates:GrinderStateRow[]=[];
      try {
        const installed=await lease.query(`SELECT to_regclass('public.dana_dsf_grinder_state_v1') IS NOT NULL
          AND to_regclass('public.dana_dsf_grinder_ledger_v1') IS NOT NULL AS installed`);
        if(installed[0]?.installed===true)grinderStates=await grinderStateRows(lease);
      } catch {grinderStates=[];}
      const hasActiveGrinders=grinderStates.length===5;
      // Load source options even before the first mapping is saved in Admin.
      client=this.makeClient();this.source=client;
      client.on('error',()=>{this.readerState='UNAVAILABLE';});
      const deadline=Date.now()+90000;
      watchdog=setTimeout(()=>{void client?.end().catch(()=>undefined);},90000);watchdog.unref?.();
      await client.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='1s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      await client.query('SET LOCAL max_parallel_workers_per_gather=0');
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const identity=(await client.query(SOURCE_IDENTITY_SQL)).rows[0];
      if(!identity?.is_source||!identity.not_meshforge||!identity.read_only)throw new DsfRefusal('WRONG_SOURCE_OR_NOT_READ_ONLY');
      const at:string=identity.now_utc;
      const clockGap=timestampUs(new Date().toISOString())-timestampUs(at);
      if(clockGap>10000000n||clockGap< -10000000n)throw new DsfRefusal('CLOCK_DIFFERENCE');
      const account=(await client.query(DSF_ACCOUNT_SQL)).rows[0];
      const rights=(await client.query(ROLE_CHECK_SQL)).rows[0];
      this.accountPolicy=dsfAccountPolicy(this.config,account,rights);
      try {
        const names=this.config.departmentNames??new Map<string,string>();
        const options=((await client.query(SOURCE_OPTIONS_SQL,[[...names.keys()]])).rows as SourceOption[])
          .map(x=>({...x,department:x.department||dsfDepartmentCode(x.department_name,names)||''}));
        if(options.length>5000)throw new DsfRefusal('SOURCE_OPTION_LIMIT');
        const valid=options.filter(x=>this.uuid(x.mapping_id)&&this.uuid(x.whiteboard_id)&&this.uuid(x.op_id)&&this.uuid(x.line_id)&&
          this.uuid(x.department_id)&&/^[0-9]+$/.test(x.department)&&typeof x.line_name==='string'&&x.line_name.trim().length>0&&typeof x.whiteboard_name==='string'&&x.whiteboard_name.trim().length>0);
        this.sourceOptions=valid;this.sourceOptionsRefreshedAt=at;
        this.sourceOptionsProblem=valid.length?null:{reason:options.length?'NO_VALID_SOURCES':'NO_SOURCES',code:null};
      } catch(e) {
        this.sourceOptions=[];this.sourceOptionsRefreshedAt=null;
        const reason=e instanceof DsfRefusal?e.reason:'SOURCE_LIST_QUERY_FAILED',code=dsfFailureCode(e);
        if(this.sourceOptionsProblem?.reason!==reason||this.sourceOptionsProblem?.code!==code)
          this.logger.warn('DSF source list could not be read: '+reason+(code?' ('+code+')':''));
        this.sourceOptionsProblem={reason,code};
      }
      // The five grinders share this *same* validated, read-only DSF connection.
      // Errors in their stream cannot block the existing cutter-count writer.
      let grinderBatches:GrinderBatch[]=[];
      if(hasActiveGrinders) {
        try { grinderBatches=await collectGrinderBatches(client,grinderStates,at); }
        catch { grinderBatches=[]; /* Report stale status from last_success_at, never invented credits. */ }
      }
      for(const item of candidates) {
        const m=item.machine,mapping=item.mapping;
        if(this.stopped||Date.now()>=deadline)throw new DsfRefusal('READ_DEADLINE');
        await lease.query('SELECT 1'); // verify the shared-reader lease connection is still alive
        const found=(await client.query(MAPPING_SQL,[mapping.mapping_id])).rows;
        const actual=found[0];
        const identityMatches=found.length===1&&actual.mapping_id===mapping.mapping_id&&
          actual.whiteboard_id===mapping.whiteboard_id&&actual.op_id===mapping.op_id&&
          actual.line_id===mapping.line_id&&actual.department_id===mapping.department_id&&
          actual.line_name===mapping.line_name&&actual.whiteboard_name===mapping.whiteboard_name&&
          (mapping.manual || actual.op_name==='OP10')&&actual.operation_line_matches===true&&actual.mapping_active===true&&
          actual.whiteboard_active===true&&actual.running_reasons>0&&
          (mapping.manual || (actual.active_mappings===1&&JSON.stringify(actual.known_mapping_ids)===JSON.stringify(mapping.known_mapping_ids)))&&
          dsfDepartmentCode(actual.department_name,this.config.departmentNames??new Map())===mapping.department;
        if(!identityMatches) {nextStates.set(m.machine_id,{status:'MAPPING_REVIEW',note:'Source identity changed or is ambiguous'});nextCaches.delete(m.machine_id);continue;}
        let shift;
        try {shift=chooseShift((await client.query(SHIFTS_SQL,[mapping.line_id,at])).rows,at);}
        catch(e) {if(!(e instanceof DsfRefusal))throw e;nextStates.set(m.machine_id,{status:'SHIFT_REVIEW',note:'Source shift boundaries missing or ambiguous'});nextCaches.delete(m.machine_id);continue;}
        let alternativeActivity=false;
        if(!mapping.manual) for(const alternative of mapping.other_mappings) {
          const check=(await client.query(OTHER_MAPPING_ACTIVITY_SQL,[alternative.whiteboard_id,alternative.mapping_id,shift.starts_at,at,mapping.op_id])).rows[0];
          if(!check || check.has_activity!==false)alternativeActivity=true;
        }
        if(alternativeActivity){nextStates.set(m.machine_id,{status:'MAPPING_REVIEW',note:'Alternate source mapping carried current-shift production'});nextCaches.delete(m.machine_id);continue;}
        const previous=nextCaches.get(m.machine_id);
        // Incremental reads overlap 30 minutes; recheck the bounded current shift every 30 minutes.
        // This catches older in-shift changes without trusting a nonexistent source updated_at column.
        const range=replacementStart(previous,shift,at,1800,1800);
        const rows=(await client.query(CYCLES_SQL,[mapping.whiteboard_id,mapping.mapping_id,range.from,at])).rows;
        try {
          const fresh=reconcileRows(previous,shift,range.from,at,rows,mapping.op_id,range.full,new Date().toISOString());
          nextCaches.set(m.machine_id,fresh);nextStates.set(m.machine_id,{status:'OK',note:mapping.manual?'Admin-approved DSF source, current source shift':'Running production for the physical machine, current source shift'});
        } catch(e) {
          if(!(e instanceof DsfRefusal))throw e;
          nextStates.set(m.machine_id,{status:'DATA_REVIEW',note:'Source count evidence requires review'});nextCaches.delete(m.machine_id);
        }
      }
      await client.query('ROLLBACK');
      // Release source connection before any local count mutations. The source
      // connection is strictly read-only. A write failure NEVER invalidates DSF.
      await client.end();client=null;this.source=null;
      // No Dana manufacturing writes are made until the DSF read-only session is closed.
      // Local grinder ledger accounting and cutter attribution remain independent.
      if(grinderBatches.length) {
        try {await commitGrinderBatches(this.db,grinderBatches);}
        catch { /* Local balance remains stale, not silently adjusted. */ }
      }
      if(this.writerEnabled) {
        const fresh=candidates.filter(item=>item.machine.machine_type==='PRODUCTION' && ['132','152'].includes(item.machine.department) && nextStates.get(item.machine.machine_id)?.status==='OK')
          .map(item=>({machine_id:item.machine.machine_id,machine_number:item.machine.machine_number,
            department:item.machine.department,cache:nextCaches.get(item.machine.machine_id)!}));
        try { this.writerResults=await applyDsfCutterCounts(this.db,fresh); }
        catch { this.writerResults=new Map(fresh.map(m=>[m.machine_id,
          {status:'REVIEW' as const,reason:'DANA_WRITE_UNAVAILABLE'}])); }
      }
      this.caches=nextCaches;this.states=nextStates;
      this.readerState=[...nextStates.values()].some(x=>x.status==='OK')?'OK':'UNAVAILABLE';
      this.lastSuccess=new Date().toISOString();this.failures=0;
      if(this.lastFailure)this.logger.log('DSF refresh recovered.');
      this.lastFailure=null;
    } catch(e) {
      this.failures+=1;this.readerState='UNAVAILABLE';
      const reason=e instanceof DsfRefusal?e.reason:'SOURCE_CONNECTION_OR_QUERY_FAILED';
      // Driver/OS error codes (ECONNREFUSED, ETIMEDOUT, 28P01, ...) identify a wrong port, SSL
      // mode or password without exposing the message, host or credentials.
      const code=dsfFailureCode(e);
      if(this.lastFailure?.reason!==reason||this.lastFailure?.code!==code)
        this.logger.warn('DSF refresh failed: '+reason+(code?' ('+code+')':''));
      this.lastFailure={reason,code,at:new Date().toISOString()};
      const safeNote=reason==='READ_ONLY_ROLE_REQUIRED'?'Dedicated read-only source user required':
        reason==='SOURCE_ACCOUNT_MISMATCH'?'Source account/database does not match approved configuration':
        reason==='CLOCK_DIFFERENCE'?'Source and MeshForge clocks need review':
        reason==='READER_BUSY'?'Another DSF reader is active':'DSF refresh unavailable';
      for(const m of this.machines) {
        const state=this.states.get(m.machine_id);
        if(!state||['OK','STALE','UNAVAILABLE','WAITING'].includes(state.status))
          this.states.set(m.machine_id,{status:this.caches.has(m.machine_id)?'STALE':'UNAVAILABLE',note:safeNote});
      }
      // No raw database error text, credential object, hostname, password, or connection string is logged.
    } finally {
      if(watchdog)clearTimeout(watchdog);
      if(client) {try{await client.end();}catch{/* no unsafe diagnostic logging */}}
      this.source=null;
      if(lease) {
        if(held)try{await lease.query('SELECT pg_advisory_unlock(1437329,77311)');}catch{/* released by connection close */}
        try{await lease.release();}catch{/* no raw error output */}
      }
      this.busy=false;
      const scheduled=this.pendingImmediate ? Math.max(1000,this.nextImmediateAllowedAt-Date.now()) :
        Math.min(3600,this.config.interval*Math.pow(2,Math.min(this.failures,3)))*1000;
      this.pendingImmediate=false;
      if(scheduled<15000)this.nextImmediateAllowedAt=Date.now()+15000;
      this.schedule(scheduled);
    }
  }
}
