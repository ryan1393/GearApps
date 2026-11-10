/** CutGrind (Department 45) grinder credit importer, restored unchanged in behaviour.
 * It runs only when the grinder ledger tables (dana_dsf_grinder_state_v1 / _ledger_v1) already
 * exist in the Gear Apps database. This codebase does not create them and has no grinder screen:
 * they depend on ANCA grinder tracking and loose coater blade sets, which are not part of it.
 *
 * Reuses the existing DSF read-only poll connection.
 * All source reads happen BEFORE any Dana-side writes; no DSF mutation is possible here.
 * Credit scope begins at a deliberately recorded installation cutoff; never backfill guesses.
 */
import { DataSource } from 'typeorm';
/** Unlike the older shared helper, this parses microseconds without counting the millisecond portion twice.
 * CutGrind records have nonzero fractions, so exact timestamp validation is mandatory.
 */
function grinderTimestampUs(s:string):bigint {
  const match=/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(s);
  if(!match)throw new Error('GRINDER_TIMESTAMP_INVALID');
  const zone=match[4]==='Z'?'Z':match[4].length===3?match[4]+':00':match[4];
  const fullSeconds=Date.parse(match[1]+'T'+match[2]+'.000'+zone);
  if(!Number.isFinite(fullSeconds))throw new Error('GRINDER_TIMESTAMP_INVALID');
  return BigInt(fullSeconds)*1000n + BigInt((match[3]||'').padEnd(6,'0'));
}

export interface GrinderSourceReader { query(text:string, values?:unknown[]):Promise<{rows:any[]}>; }
export interface GrinderStateRow {
 machine_id:string;machine_number:string;mapping_id:string;whiteboard_id:string;
 op_id:string;line_id:string;whiteboard_name:string;line_name:string;
 started_at:string;ingested_through:string;
}
export interface GrinderEvent {event_id:string;at:string;at_us:string;}
export interface GrinderBatch {state:GrinderStateRow;from:string;until:string;events:GrinderEvent[];}

const WINDOW_MS=15*60*1000;
const OVERLAP_MS=30*60*1000;
const MAX_ROWS=1000;
const STATUS_SQL=`SELECT s.machine_id::text,s.machine_number,s.mapping_id::text,s.whiteboard_id::text,
 s.op_id::text,s.line_id::text,s.whiteboard_name,s.line_name,
 to_char(s.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
 to_char(s.ingested_through AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ingested_through
 FROM public.dana_dsf_grinder_state_v1 s
 JOIN public.machines m ON m.id=s.machine_id
 JOIN public.departments d ON d.id=m.department_id
 WHERE s.enabled AND m.active AND m.enabled AND m."deletedAt" IS NULL
 AND d.code='45' AND d.active AND d.enabled AND d."deletedAt" IS NULL AND m.machine_type='ANCA_GRINDER'
 AND m.machine_number=s.machine_number ORDER BY s.machine_number`;
const SOURCE_MAPPING_SQL=`SELECT wm.id::text AS mapping_id,wm.whiteboard_id::text,wm.op_id::text,wm.line_id::text,
 w.name::text AS whiteboard_name,l.name::text AS line_name,d.name::text AS department,
 wm.active AS mapping_active,w.active AS whiteboard_active,
 (o.line_id=wm.line_id) AS operation_line_matches
 FROM public.tbl_whiteboard_machines wm JOIN public.tbl_whiteboard w ON w.id=wm.whiteboard_id
 JOIN public.tbl_op o ON o.id=wm.op_id JOIN public.tbl_line l ON l.id=wm.line_id
 LEFT JOIN public.tbl_department d ON d.id=l.department_id WHERE wm.id=$1::uuid`;
const SOURCE_CYCLE_SQL=`WITH bounded AS MATERIALIZED (
 SELECT c.id,c."timestamp",c.part_count,c.code FROM public.tbl_whiteboard_cycles_master c
 WHERE c.whiteboard_id=$1::uuid AND c.machine_id=$2::uuid
 AND c."timestamp">=GREATEST($3::timestamptz,$5::timestamptz) AND c."timestamp"<$4::timestamptz
 ORDER BY c."timestamp",c.id LIMIT 1001
 ) SELECT c.id::text AS event_id,
 (extract(epoch from c."timestamp")*1000000)::bigint::text AS at_us,
 to_char(c."timestamp" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
 c.part_count AS parts,r.code::text AS reason_code,r.op_id::text AS reason_op
 FROM bounded c LEFT JOIN public.tbl_op_state_reason r ON r.id=c.code
 ORDER BY c."timestamp",c.id`;

function epoch(s:string):number {
 const ms=Number(grinderTimestampUs(s)/1000n);
 if(!Number.isFinite(ms))throw new Error('INVALID_SOURCE_TIME');
 return ms;
}
function iso(ms:number):string{return new Date(ms).toISOString();}
export async function grinderStateRows(db:{query(sql:string,params?:unknown[]):Promise<any[]>}):Promise<GrinderStateRow[]> {
 const data=await db.query(STATUS_SQL) as GrinderStateRow[];
 if(data.length!==5 || new Set(data.map(x=>x.machine_id)).size!==5 || new Set(data.map(x=>x.mapping_id)).size!==5)
   throw new Error('GRINDER_MAPPING_COUNT_OR_IDENTITY_CHANGED');
 return data;
}

/** Bounded, index-compatible lookups: five machines, <= 1001 rows each, <= 15 minutes new time per tick.
 * Empty intervals still advance the cursor; 30m overlap + unique source keys prevent repeated credit.
 * Overlong outages are processed in successive 15m windows, never silently skipped.
 */
export async function collectGrinderBatches(source:GrinderSourceReader,states:GrinderStateRow[],asOf:string):Promise<GrinderBatch[]> {
 if(states.length!==5)throw new Error('EXPECTED_FIVE_GRINDERS');
 const batches:GrinderBatch[]=[];
 const seenIds=new Set<string>();
 for(const state of states){
   if(seenIds.has(state.mapping_id))throw new Error('DUPLICATE_GRINDER_SOURCE_MAPPING');
   seenIds.add(state.mapping_id);
   const check=(await source.query(SOURCE_MAPPING_SQL,[state.mapping_id])).rows;
   const match=check[0];
   if(check.length!==1 || !match || match.mapping_id!==state.mapping_id ||
      match.whiteboard_id!==state.whiteboard_id || match.op_id!==state.op_id ||
      match.line_id!==state.line_id || match.whiteboard_name!==state.whiteboard_name ||
      match.line_name!==state.line_name || match.department!=='CUTTER GRIND' ||
      match.mapping_active!==true || match.whiteboard_active!==true || match.operation_line_matches!==true)
     throw new Error('GRINDER_SOURCE_MAPPING_DRIFT');
   const started=epoch(state.started_at), cursor=epoch(state.ingested_through), now=epoch(asOf);
   if(cursor<started || cursor>now+1000 || now<started)throw new Error('GRINDER_CLOCK_OR_CURSOR_INVALID');
   const upper=Math.min(now,cursor+WINDOW_MS);
   if(upper<=cursor)continue;
   const lower=Math.max(started,cursor-OVERLAP_MS);
   const rows=(await source.query(SOURCE_CYCLE_SQL,[state.whiteboard_id,state.mapping_id,iso(lower),iso(upper),state.started_at])).rows;
   if(rows.length>MAX_ROWS)throw new Error('GRINDER_CYCLE_ROW_LIMIT_REVIEW');
   const keys=new Set<string>();
   const events:GrinderEvent[]=[];
   for(const r of rows){
     if(!/^\d+$/.test(String(r.event_id)) || !/^\d+$/.test(String(r.at_us)) ||
        !Number.isSafeInteger(Number(r.parts)) || Number(r.parts)<0 || Number(r.parts)>1 ||
        r.reason_code===null || r.reason_op!==state.op_id)throw new Error('GRINDER_CYCLE_DATA_REVIEW');
     const timestamp=grinderTimestampUs(String(r.at));
     if(timestamp!==BigInt(r.at_us)||timestamp<BigInt(lower)*1000n||timestamp>=BigInt(upper)*1000n)
       throw new Error('GRINDER_CYCLE_TIME_REVIEW');
     const key=r.event_id+':'+r.at_us;
     if(keys.has(key))throw new Error('DUPLICATE_SOURCE_CYCLE');
     keys.add(key);
     if(r.reason_code==='1'){
       if(Number(r.parts)!==1)throw new Error('GRINDER_RUN_CYCLE_NOT_ONE_PIECE');
       events.push({event_id:String(r.event_id),at:String(r.at),at_us:String(r.at_us)});
     }
   }
   batches.push({state,from:iso(lower),until:iso(upper),events});
 }
 return batches;
}

/** Append credits + advance each complete, validated poll window atomically in Dana PostgreSQL.
 * The DSF reader is already disconnected when this function is called.
 */
export async function commitGrinderBatches(db:DataSource,batches:GrinderBatch[]):Promise<void> {
 if(!batches.length)return;
 await db.transaction('READ COMMITTED',async m=>{
   await m.query("SET LOCAL lock_timeout='2s'");
   await m.query("SET LOCAL statement_timeout='15s'");
   await m.query("SELECT pg_advisory_xact_lock(hashtext('dana-dsf-grinder-ledger-v1'))");
   for(const batch of batches){
     const prior=(await m.query(`SELECT machine_id::text,
       to_char(ingested_through AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ingested_through,
       mapping_id::text,enabled FROM public.dana_dsf_grinder_state_v1 WHERE machine_id=$1::uuid FOR UPDATE`,
       [batch.state.machine_id]))[0];
     if(!prior || !prior.enabled || prior.mapping_id!==batch.state.mapping_id ||
        grinderTimestampUs(prior.ingested_through)!==grinderTimestampUs(batch.state.ingested_through))
       throw new Error('GRINDER_STATE_CHANGED_SINCE_SOURCE_READ');
     if(batch.events.length){
       const ids=batch.events.map(e=>e.event_id),ats=batch.events.map(e=>e.at);
       await m.query(`INSERT INTO public.dana_dsf_grinder_ledger_v1
         (machine_id,entry_kind,pieces,source_mapping_id,source_event_id,source_event_at)
         SELECT $1::uuid,'DSF_CREDIT',1,$2::uuid,x.event_id,x.at
         FROM unnest($3::text[],$4::timestamptz[]) AS x(event_id,at)
         ON CONFLICT DO NOTHING`,[batch.state.machine_id,batch.state.mapping_id,ids,ats]);
     }
     const updated=await m.query(`UPDATE public.dana_dsf_grinder_state_v1
       SET ingested_through=$2::timestamptz,last_success_at=clock_timestamp(),state='OK',
           last_error=NULL WHERE machine_id=$1::uuid AND mapping_id=$3::uuid RETURNING machine_id`,
       [batch.state.machine_id,batch.until,batch.state.mapping_id]);
     if(updated.length!==1)throw new Error('GRINDER_CURSOR_WRITE_FAILED');
   }
 });
}
