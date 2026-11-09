import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');
const setup=read('tools/setup-gear-apps.ps1');
const start=read('tools/start-gear-apps.ps1');
const tests=read('tools/run-all-tests.ps1');
const validate=read('tools/validate-gear-apps.ps1');
const assert=(c,m)=>{if(!c) throw new Error(m);};

for(const [name,text] of [['setup',setup],['start',start],['tests',tests],['validate',validate]]){
  assert(!/\$env:NX_ISOLATION_PLUGINS\b/.test(text), `${name} still assigns invalid NX_ISOLATION_PLUGINS`);
  assert(!/`\$env:NX_ISOLATION_PLUGINS\b/.test(text), `${name} still embeds invalid NX_ISOLATION_PLUGINS`);
}
assert(setup.includes("$env:NX_ISOLATE_PLUGINS = 'false'"),'Setup must use official NX_ISOLATE_PLUGINS');
assert(start.includes("$env:NX_ISOLATE_PLUGINS = 'false'"),'Startup must use official NX_ISOLATE_PLUGINS');
assert(
  setup.includes('npm ci --prefer-offline --no-audit --no-fund'),
  'Clean dependency path must use npm ci --prefer-offline --no-audit --no-fund'
);
assert(
  setup.includes('Try-UseSharedDependencyCache') &&
  setup.includes('Publish-SharedDependencyCache') &&
  setup.includes('Test-NxInstallIntegrity'),
  'Fast setup must validate/reuse a shared dependency cache safely'
);
assert(setup.includes('Test-NxInstallIntegrity'),'Setup must verify installed Nx');
assert(setup.includes('node --check $worker'),'Setup must syntax-check Nx plugin worker');
assert(setup.includes('npx --no-install nx --version'),'Setup must prove the installed Nx CLI executes');
assert(!setup.includes("packages.'node_modules/nx'.version"),'Setup must not fail based on package-lock internal JSON shape');
assert(setup.includes('Get-DependencyCacheKey'),'Setup must key dependency cache deterministically');
assert(setup.includes('Get-FileHash -LiteralPath $lockFile -Algorithm SHA256'),'Dependency cache must be tied to the exact package-lock hash');
assert(setup.includes('process.versions.modules'),'Dependency cache must include Node ABI');
assert(start.includes('node --check $NxWorker'),'Startup must reject corrupt Nx install');

assert(validate.includes("$env:NX_WORKSPACE_DATA_DIRECTORY"),'Validation must isolate Nx workspace-data from the repo .nx tree');
assert(validate.includes("$env:NX_CACHE_DIRECTORY"),'Validation must isolate Nx cache from the repo .nx tree');
assert(validate.includes('gear-apps-nx-validation-'),'Validation must use a unique temporary Nx validation root');
assert(!validate.includes("Invoke-NativeChecked '[1/5] Resetting Nx...'"),'Validation must not hard-fail on repo-wide nx reset');



assert(setup.includes('function Remove-DirectoryRobust'),'Setup must have Windows lock-tolerant node_modules cleanup');
assert(setup.includes('cmd.exe /d /c "rd /s /q'),'Setup must have cmd/rmdir fallback for locked dependency trees');
assert(
  setup.includes('function Remove-DirectoryRobust') &&
  setup.includes('Remove-ProjectNodeModules') &&
  setup.includes('Remove-DirectoryRobust -Path $nodeModulesPath'),
  'Nx recovery must retain robust node_modules removal'
);

console.log('[PASS] Nx clean-install/startup contract passed.');
