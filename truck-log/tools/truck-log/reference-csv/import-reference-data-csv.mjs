import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  workspaceRoot, loadDb, qid, norm, assertCurrentReferenceSchema, assertMasterTable,
} from './db-common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = workspaceRoot(here);
const dropDir = path.join(root, 'reference-data-import');
const defaultCsv = path.join(dropDir, 'reference-data.csv');
const argIndex = process.argv.indexOf('--file');
const stdinMode = process.argv.includes('--stdin');
function resolveCsvPath() {
  if (argIndex >= 0 && process.argv[argIndex+1]) return path.resolve(process.argv[argIndex+1]);
  if (fs.existsSync(defaultCsv)) return defaultCsv;
  if (!fs.existsSync(dropDir)) return defaultCsv;
  const candidates = fs.readdirSync(dropDir)
    .filter(n => /\.csv$/i.test(n) && !/^reference-data-template\.csv$/i.test(n))
    .map(n => path.join(dropDir,n));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new Error(`Multiple CSV files found in ${dropDir}. Rename the one you want to reference-data.csv, or run with --file <path>.`);
  return defaultCsv;
}
const csvPath = stdinMode ? '<stdin>' : path.resolve(resolveCsvPath());
const { Client, config } = loadDb(root);
const client = new Client(config);

function parseCsv(text) {
  const rows=[]; let row=[]; let field=''; let quoted=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (quoted) {
      if (ch==='"' && text[i+1]==='"') { field+='"'; i++; }
      else if (ch==='"') quoted=false;
      else field+=ch;
    } else {
      if (ch==='"') quoted=true;
      else if (ch===',') { row.push(field); field=''; }
      else if (ch==='\n') { row.push(field); rows.push(row); row=[]; field=''; }
      else if (ch!=='\r') field+=ch;
    }
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function key(s){return String(s||'').trim().toLowerCase().replace(/[ _-]+/g,'');}
function digits(phone){return String(phone||'').replace(/\D/g,'');}
function locationName(name,state){
  let n=String(name||'').trim().replace(/\s+/g,' ');
  const st=String(state||'').trim().replace(/\s+/g,' ');
  if (!st) return n;
  const low=n.toLowerCase(), suffix=`, ${st}`.toLowerCase();
  return low.endsWith(suffix) ? n : `${n}, ${st}`;
}

function loadRows() {
  if (!stdinMode && !fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
  const csvText = stdinMode ? fs.readFileSync(0, 'utf8') : fs.readFileSync(csvPath, 'utf8');
  const all=parseCsv(csvText.replace(/^\uFEFF/,''));
  while (all.length && all[all.length-1].every(x=>!String(x).trim())) all.pop();
  if (all.length<2) throw new Error('CSV must contain a header and at least one data row.');
  const header=all[0].map(key);
  const find=(...aliases)=>header.findIndex(h=>aliases.map(key).includes(h));
  const typeIx=find('type','record type','category');
  const nameIx=find('name','standard name','canonical name','final standard','standard');
  const phoneIx=find('phone','phone number','driver phone');
  const stateIx=find('state','province','state province');
  if (typeIx<0 || nameIx<0) throw new Error('CSV requires Type plus Name (or Final Standard) columns. Optional: Phone, State.');

  const groups={drivers:new Map(),carriers:new Map(),locations:new Map()};
  const skipped=[];
  for (let i=1;i<all.length;i++) {
    const raw=all[i];
    if (raw.every(x=>!String(x).trim())) continue;
    const line=i+1;
    const type=key(raw[typeIx]);
    const name=String(raw[nameIx]||'').trim().replace(/\s+/g,' ');
    if (!name) { skipped.push(`line ${line}: blank name`); continue; }
    let target;
    if (['driver','drivers'].includes(type)) target='drivers';
    else if (['carrier','carriers'].includes(type)) target='carriers';
    else if (['location','locations','origin','origins','destination','destinations'].includes(type)) target='locations';
    else { skipped.push(`line ${line}: unsupported Type '${raw[typeIx]||''}'`); continue; }

    let finalName=name, phone='';
    if (target==='locations') finalName=locationName(name,stateIx>=0?raw[stateIx]:'');
    if (target==='drivers' && phoneIx>=0 && String(raw[phoneIx]||'').trim()) {
      phone=digits(raw[phoneIx]);
      if (phone.length<7 || phone.length>15) throw new Error(`Line ${line}: Driver Phone must contain 7-15 digits when supplied.`);
    }
    const n=norm(finalName);
    if (!n) continue;
    if (groups[target].has(n)) {
      const existing=groups[target].get(n);
      if (target==='drivers' && !existing.phone && phone) existing.phone=phone;
      continue;
    }
    groups[target].set(n,{name:finalName,phone});
  }
  const result={
    drivers:[...groups.drivers.values()],
    carriers:[...groups.carriers.values()],
    locations:[...groups.locations.values()],
    skipped,
  };
  if (!result.drivers.length && !result.carriers.length && !result.locations.length) throw new Error('CSV contained no importable Driver/Carrier/Location rows.');
  return result;
}

async function insertRows(table, rows, cols) {
  if (!rows.length) return 0;
  const fields=['name'];
  if (table==='drivers' && cols.has('phone')) fields.push('phone');
  if (cols.has('active')) fields.push('active');
  if (cols.has('created_at')) fields.push('created_at');
  if (cols.has('updated_at')) fields.push('updated_at');
  let inserted=0;
  for (let start=0;start<rows.length;start+=250) {
    const part=rows.slice(start,start+250); const params=[]; const values=[];
    for (const item of part) {
      const one=[];
      params.push(item.name); one.push(`$${params.length}`);
      if (table==='drivers' && cols.has('phone')) { params.push(item.phone||null); one.push(`$${params.length}`); }
      if (cols.has('active')) one.push('TRUE');
      if (cols.has('created_at')) one.push('NOW()');
      if (cols.has('updated_at')) one.push('NOW()');
      values.push(`(${one.join(',')})`);
    }
    const r=await client.query(
      `INSERT INTO ${qid(table)}(${fields.map(qid).join(',')}) VALUES ${values.join(',')} ON CONFLICT DO NOTHING RETURNING id`,
      params,
    );
    inserted += r.rowCount || 0;
  }
  return inserted;
}

async function verifyRows(table, rows) {
  if (!rows.length) return;
  const wanted=[...new Set(rows.map(r=>norm(r.name)))];
  const found=new Set();
  for (let i=0;i<wanted.length;i+=1000) {
    const part=wanted.slice(i,i+1000);
    const r=await client.query(`SELECT name FROM ${qid(table)} WHERE LOWER(BTRIM(name))=ANY($1::text[])`,[part]);
    for (const x of r.rows) found.add(norm(x.name));
  }
  const missing=wanted.filter(x=>!found.has(x));
  if (missing.length) throw new Error(`${table}: ${missing.length} CSV name(s) were not found after import.`);
}

const data=loadRows();
await client.connect();
try {
  console.log('\n============================================================');
  console.log(' TRUCK LOG - IMPORT REFERENCE DATA CSV');
  console.log('============================================================\n');
  console.log(`[INFO] CSV: ${csvPath}`);
  console.log(`[INFO] Database: ${config.host}:${config.port}/${config.database}`);
  console.log(`[INFO] Parsed: ${data.drivers.length} Drivers, ${data.carriers.length} Carriers, ${data.locations.length} Locations.`);
  if (data.skipped.length) console.log(`[WARN] ${data.skipped.length} invalid/unsupported row(s) will be skipped.`);

  await assertCurrentReferenceSchema(client);
  const dcols=await assertMasterTable(client,'drivers');
  const ccols=await assertMasterTable(client,'carriers');
  const lcols=await assertMasterTable(client,'locations');

  async function execute(commit,label) {
    await client.query('BEGIN');
    try {
      const inserted={
        drivers:await insertRows('drivers',data.drivers,dcols),
        carriers:await insertRows('carriers',data.carriers,ccols),
        locations:await insertRows('locations',data.locations,lcols),
      };
      await verifyRows('drivers',data.drivers);
      await verifyRows('carriers',data.carriers);
      await verifyRows('locations',data.locations);
      await client.query(commit?'COMMIT':'ROLLBACK');
      console.log(`[PASS] ${label} ${commit?'committed':'completed and rolled back'}.`);
      return inserted;
    } catch(e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    }
  }

  console.log('[INFO] Running rollback-only import preflight...');
  await execute(false,'PRE-FLIGHT');
  console.log('[INFO] Preflight passed. Importing for real...');
  const inserted=await execute(true,'FINAL IMPORT');
  console.log('\n[PASS] CSV reference-data import complete.');
  console.log(JSON.stringify({parsed:{drivers:data.drivers.length,carriers:data.carriers.length,locations:data.locations.length},inserted,skipped:data.skipped.length},null,2));
  if (data.skipped.length) {
    console.log('\nSkipped rows:');
    for (const s of data.skipped.slice(0,50)) console.log(`  - ${s}`);
    if (data.skipped.length>50) console.log(`  ... and ${data.skipped.length-50} more`);
  }
} finally {
  await client.end();
}
