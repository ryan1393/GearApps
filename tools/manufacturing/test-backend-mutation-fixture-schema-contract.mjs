import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();

function walk(dir,out=[]){
  for(const e of fs.readdirSync(contractPath(process.cwd(), dir),{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory()) walk(p,out);
    else if(e.isFile() && e.name.endsWith('.orm-entity.ts')) out.push(p);
  }
  return out;
}

const entityTables=new Set();
for(const file of walk(contractPath(root,'libs','manufacturing','server','data-access','src','lib','database','entities'))){
  const text=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  const m=text.match(/@Entity\(\{\s*name:\s*['"]([^'"]+)['"]/);
  if(m) entityTables.add(m[1]);
}

const fixtureFiles=[
  'tools/manufacturing/test-data/ensure-backend-mutation-test-fixtures.mjs',
  'tools/manufacturing/test-data/cleanup-backend-mutation-direct-fixtures.mjs',
];

const rawTables=new Set();
for(const file of fixtureFiles){
  const text=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  const re=/\b(?:from|join|insert\s+into|update|delete\s+from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  for(const m of text.matchAll(re)){
    const table=m[1].toLowerCase();
    if(!['set','where','select','values','the'].includes(table)) rawTables.add(table);
  }
}

const missing=[...rawTables].filter(t=>!entityTables.has(t)).sort();
if(missing.length){
  throw new Error(`Backend mutation fixture uses raw SQL table(s) with no mapped TypeORM entity: ${missing.join(', ')}`);
}
if(!rawTables.has('part_types')){
  throw new Error('Backend mutation fixture must resolve cutter part types from the actual part_types table.');
}
if(rawTables.has('cutter_part_types')){
  throw new Error('Obsolete raw SQL table cutter_part_types must not appear in backend mutation fixtures.');
}
console.log(`[PASS] Backend mutation fixture raw SQL tables all map to TypeORM entities (${[...rawTables].sort().join(', ')}).`);
