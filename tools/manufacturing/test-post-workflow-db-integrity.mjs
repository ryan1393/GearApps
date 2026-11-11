import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client }=pg;

function loadDotEnv(filePath){
  const out={};
  if(!fs.existsSync(filePath)) return out;
  for(const raw of fs.readFileSync(filePath,'utf8').split(/\r?\n/)){
    const line=raw.trim();
    if(!line || line.startsWith('#')) continue;
    const i=line.indexOf('=');
    if(i<1) continue;
    let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    out[line.slice(0,i).trim()]=value;
  }
  return out;
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const env={...loadDotEnv(path.resolve(root, '.env')),...process.env};
for(const key of ['DATABASE_HOST','DATABASE_PORT','DATABASE_USERNAME','DATABASE_PASSWORD','DATABASE_NAME']){
  if(typeof env[key]!=='string' || !env[key]) throw new Error(`Missing ${key}`);
}

const client=new Client({
  host:env.DATABASE_HOST,
  port:Number(env.DATABASE_PORT),
  user:env.DATABASE_USERNAME,
  password:String(env.DATABASE_PASSWORD),
  database:env.DATABASE_NAME,
});

const checks=[
  {
    name:'E2E tray blade_count matches active blade assignments',
    sql:`
      select t.id,t.serial_number,t.blade_count,count(bt.id)::int as active_assignments
        from trays t
        left join blade_tray bt on bt.tray_id=t.id and bt.enabled=true
       where t.serial_number like 'E2E-%'
       group by t.id,t.serial_number,t.blade_count
      having t.blade_count <> count(bt.id)::int
    `,
  },
  {
    name:'E2E blade is not actively assigned to multiple trays',
    sql:`
      select b.id,b.serial_number,count(bt.id)::int as active_assignments
        from blades b
        join blade_tray bt on bt.blade_id=b.id and bt.enabled=true
       where b.serial_number like 'E2E-%'
       group by b.id,b.serial_number
      having count(bt.id) > 1
    `,
  },
  {
    name:'E2E active blade assignment matches tray summary and part type',
    sql:`
      select bt.id,b.serial_number,t.serial_number as tray_serial,
             b.summary_id as blade_summary,t.summary_id as tray_summary,
             b.part_type_id as blade_part_type,t.part_type_id as tray_part_type
        from blade_tray bt
        join blades b on b.id=bt.blade_id
        join trays t on t.id=bt.tray_id
       where bt.enabled=true
         and (b.serial_number like 'E2E-%' or t.serial_number like 'E2E-%')
         and (
           (t.summary_id is not null and b.summary_id <> t.summary_id) or
           (t.part_type_id is not null and b.part_type_id <> t.part_type_id)
         )
    `,
  },
  {
    name:'E2E tray has at most one active container assignment',
    sql:`
      select t.id,t.serial_number,count(ct.id)::int as active_assignments
        from trays t
        join container_tray ct on ct.tray_id=t.id and ct.enabled=true
       where t.serial_number like 'E2E-%'
       group by t.id,t.serial_number
      having count(ct.id) > 1
    `,
  },
  {
    name:'E2E tray has at most one active location assignment',
    sql:`
      select t.id,t.serial_number,count(lt.id)::int as active_assignments
        from trays t
        join location_tray lt on lt.tray_id=t.id and lt.enabled=true
       where t.serial_number like 'E2E-%'
       group by t.id,t.serial_number
      having count(lt.id) > 1
    `,
  },
  {
    name:'E2E tray is not simultaneously active in a container and a location',
    sql:`
      select distinct t.id,t.serial_number,ct.container_id,lt.location_id
        from trays t
        join container_tray ct on ct.tray_id=t.id and ct.enabled=true
        join location_tray lt on lt.tray_id=t.id and lt.enabled=true
       where t.serial_number like 'E2E-%'
    `,
  },
  {
    name:'No blade is active in both a tray and a coater container set',
    sql:`
      select b.id,b.serial_number,bt.tray_id,cs.container_id
        from blades b
        join blade_tray bt on bt.blade_id=b.id and bt.enabled=true and bt."deletedAt" is null
        join container_set_blades sb on sb.blade_id=b.id and sb.enabled=true and sb."deletedAt" is null
        join container_sets cs on cs.id=sb.container_set_id
    `,
  },
  {
    name:'Every active coater container set is one complete set of one Summary and part type',
    sql:`
      select cs.id,cs.container_id,cs.required_blade_count,count(b.id)::int as blades
        from container_sets cs
        left join container_set_blades sb on sb.container_set_id=cs.id and sb.enabled=true and sb."deletedAt" is null
        left join blades b on b.id=sb.blade_id
       where cs.enabled=true and cs."deletedAt" is null
       group by cs.id
      having count(b.id) <> cs.required_blade_count
          or bool_or(b.summary_id <> cs.summary_id or b.part_type_id <> cs.part_type_id)
          or exists (select 1 from container_tray ct where ct.container_id=cs.container_id and ct.enabled=true)
    `,
  },
  {
    name:'E2E machine has at most one active cutter run',
    sql:`
      select machine_number,count(*)::int as active_runs
        from cutter_machine_runs
       where enabled=true and machine_number like 'E2E-%'
       group by machine_number
      having count(*) > 1
    `,
  },
  {
    name:'E2E build has at most one active cutter run',
    sql:`
      select cb.build_number,count(cmr.id)::int as active_runs
        from cutter_builds cb
        join cutter_machine_runs cmr on cmr.cutter_build_id=cb.id and cmr.enabled=true
       where cb.build_number like '%E2E%'
       group by cb.id,cb.build_number
      having count(cmr.id) > 1
    `,
  },
  {
    name:'Completed E2E build has no active machine run',
    sql:`
      select cb.build_number,cmr.machine_number,cb.completed_at,cmr.enabled
        from cutter_builds cb
        join cutter_machine_runs cmr on cmr.cutter_build_id=cb.id and cmr.enabled=true
       where cb.build_number like '%E2E%'
         and cb.completed_at is not null
    `,
  },
  {
    name:'Active E2E machine run is not marked removed',
    sql:`
      select cb.build_number,cmr.machine_number,cmr.removed_at
        from cutter_machine_runs cmr
        join cutter_builds cb on cb.id=cmr.cutter_build_id
       where cmr.enabled=true
         and (cmr.machine_number like 'E2E-%' or cb.build_number like '%E2E%')
         and cmr.removed_at is not null
    `,
  },
  {
    name:'E2E cutter body has at most one open build',
    sql:`
      select cb.cutter_body_id,count(*)::int as open_builds,
             max(coalesce(body.dana_serial_number,body.mf_serial_number,'')) as body_identifier
        from cutter_builds cb
        join cutter_bodies body on body.id=cb.cutter_body_id
       where cb.completed_at is null
         and (
           coalesce(body.dana_serial_number,'') like 'E2E-%' or
           coalesce(body.mf_serial_number,'') like 'E2E-%' or
           cb.build_number like '%E2E%'
         )
       group by cb.cutter_body_id
      having count(*) > 1
    `,
  },
];

await client.connect();
try{
  console.log('============================================================');
  console.log(' POST-WORKFLOW DATABASE INTEGRITY / RECONCILIATION');
  console.log(' Read-only checks scoped to E2E test records');
  console.log('============================================================');

  let failures=0;
  for(const check of checks){
    const result=await client.query(check.sql);
    if(result.rows.length){
      failures++;
      console.error(`[FAIL] ${check.name}`);
      console.error(JSON.stringify(result.rows.slice(0,20),null,2));
    }else{
      console.log(`[PASS] ${check.name}`);
    }
  }

  if(failures){
    throw new Error(`${failures} post-workflow database integrity check(s) failed.`);
  }

  console.log(`[PASS] POST-WORKFLOW DATABASE INTEGRITY PASSED (${checks.length} checks).`);
} finally {
  await client.end();
}
