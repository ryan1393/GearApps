import { contractPath } from '../lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..', '..', '..');
const read=(p)=>fs.readFileSync(contractPath(root,p),'utf8');
const assert=(c,m)=>{if(!c) throw new Error(m);};

const fixture=read('tools/manufacturing/test-data/ensure-workflow-test-fixtures.mjs');
const enumSource=read('libs/manufacturing/shared/util-types/src/lib/enums/blade-status.enum.ts');

assert(enumSource.includes("WAITING_FOR_GRINDING = 'waiting_for_grinding'"),
  'BladeStatus enum changed unexpectedly');
assert(fixture.includes("b.status = 'waiting_for_grinding'"),
  'Fixture lookup must use lowercase BladeStatus value');
assert(fixture.includes("'waiting_for_grinding', 0, true"),
  'Fixture insert must use lowercase BladeStatus value');
assert(!fixture.includes("b.status = 'WAITING_FOR_GRINDING'"),
  'Fixture lookup still confuses tray-stage code with blade status');
assert(!fixture.includes("'WAITING_FOR_GRINDING', 0, true"),
  'Fixture insert still confuses tray-stage code with blade status');

console.log('[PASS] Blade-status fixture contract passed.');
