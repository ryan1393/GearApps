import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(contractPath(process.cwd(), p),'utf8');
const checks=[
  {
    file:'libs/manufacturing/server/feat-tray/src/lib/server-feat-tray.service.ts',
    pairs:[
      ['tray.current_stage_id = grindingStage.id;', 'tray.current_stage = grindingStage;'],
      ['tray.current_stage_id = readyForCoatingStage.id;', 'tray.current_stage = readyForCoatingStage;'],
    ],
  },
  {
    file:'libs/manufacturing/server/feat-container-tray/src/lib/server-feat-container-tray.service.ts',
    pairs:[
      ['tray.current_stage_id = atCoaterStage.id;', 'tray.current_stage = atCoaterStage;'],
    ],
  },
  {
    file:'libs/manufacturing/server/feat-greenshed/src/lib/server-feat-greenshed.service.ts',
    pairs:[
      ['build.status_id = runningStatus.id;', 'build.status = runningStatus;'],
      ['build.status_id = targetStatus.id;', 'build.status = targetStatus;'],
    ],
  },
  {
    file:'libs/manufacturing/server/feat-cutter-build/src/lib/server-feat-cutter-build.service.ts',
    pairs:[
      ['build.status_id = closedStatus.id;', 'build.status = closedStatus;'],
    ],
  },
];

for(const check of checks){
  const text=read(check.file);
  for(const [fk,relation] of check.pairs){
    const fkIndex=text.indexOf(fk);
    if(fkIndex<0) throw new Error(`${check.file}: missing ${fk}`);
    const relationIndex=text.indexOf(relation,fkIndex);
    if(relationIndex<0 || relationIndex-fkIndex>220){
      throw new Error(`${check.file}: ${fk} is not synchronized with ${relation}`);
    }
  }
}

console.log('[PASS] Loaded-relation/FK transition synchronization contract passed.');
