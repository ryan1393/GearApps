import fs from 'node:fs';
const files=['tools/test-data/ensure-automatic-test-user.mjs','tools/test-data/ensure-workflow-test-fixtures.mjs'];
for(const f of files){
 const t=fs.readFileSync(f,'utf8');
 if(t.includes("'USER'")||t.includes("'EMAIL'")) throw new Error(`${f} uses uppercase DB enum literals; expected user/email`);
}
console.log('[PASS] Direct-SQL fixture enum contract passed.');
