import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

const root=process.cwd();
const report=JSON.parse(fs.readFileSync(path.join(root,'docs/manufacturing/DANA_UI_MIGRATION_TEST_SURFACE.json'),'utf8'));
const tests=[...new Set([
  'tools/manufacturing/test-external-dana-ui-package-contract.mjs',
  ...report.staticMigrationSensitiveTests
])].filter(rel=>fs.existsSync(path.join(root,rel)));

const failures=[];

function conciseDiagnostic(output){
  const lines=String(output||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  return (
    lines.find(line=>/^(?:SyntaxError|TypeError|ReferenceError|RangeError|URIError|EvalError|AggregateError|Error):\s*/i.test(line)) ??
    lines.find(line=>/^\[FAIL\]/i.test(line)) ??
    lines.find(line=>/throw new Error/i.test(line)) ??
    lines.find(line=>/failed/i.test(line)) ??
    'No concise diagnostic found; inspect the test output above.'
  );
}

for(const rel of tests){
  console.log(`\n=== MIGRATION TEST ${rel} ===`);
  const r=cp.spawnSync(process.execPath,[rel],{
    cwd:root,
    encoding:'utf8',
    stdio:'pipe',
    shell:false
  });

  const output=String(r.stdout||'')+String(r.stderr||'');
  if(output)process.stdout.write(output.endsWith('\n')?output:output+'\n');

  if(r.error){
    failures.push({test:rel,status:'spawn',diagnostic:r.error.message});
    continue;
  }

  if(r.status!==0){
    failures.push({
      test:rel,
      status:`exit ${r.status}`,
      diagnostic:conciseDiagnostic(output)
    });
  }
}

if(failures.length){
  console.error(`\n[FAIL] Dana UI authoritative migration-sensitive test batch found ${failures.length} failure(s):`);
  for(const failure of failures){
    console.error(`  - ${failure.test}: ${failure.status}`);
    console.error(`    ${failure.diagnostic}`);
  }
  process.exit(1);
}

console.log(`\n[PASS] Dana UI migration-sensitive batch: ${tests.length}/${tests.length} authoritative static contracts passed.`);
