import { contractPath } from '../lib/contract-paths.mjs';
import fs from 'node:fs';
const files=['tools/manufacturing/test-data/ensure-automatic-test-user.mjs','tools/manufacturing/test-data/ensure-workflow-test-fixtures.mjs'];
for(const f of files){
 const t=fs.readFileSync(contractPath(process.cwd(), f),'utf8');
 if(t.includes("'USER'")||t.includes("'EMAIL'")) throw new Error(`${f} uses uppercase DB enum literals; expected user/email`);
}
console.log('[PASS] Direct-SQL fixture enum contract passed.');
