import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const roots=[
  'libs/server/feat-tray/src/lib/server-feat-tray.service.ts',
  'libs/server/feat-container-tray/src/lib/server-feat-container-tray.service.ts',
  'libs/server/feat-cutter-build/src/lib/server-feat-cutter-build.service.ts',
  'libs/server/feat-greenshed/src/lib/server-feat-greenshed.service.ts',
];
let failures=[];
for(const file of roots){
  const text=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  const findOneBlocks=[...text.matchAll(/findOne\s*\(\s*\{[\s\S]{0,1400}?\}\s*\)/g)];
  for(const match of findOneBlocks){
    const block=match[0];
    if(block.includes('lock:') && block.includes('relations:')){
      const line=text.slice(0,match.index).split(/\r?\n/).length;
      failures.push(`${file}:${line}`);
    }
  }
}
if(failures.length){
  throw new Error(
    'Pessimistic-lock queries must lock the base row first and load relations separately. Violations: '+
    failures.join(', ')
  );
}
console.log('[PASS] No TypeORM findOne combines pessimistic locking with relation joins.');
