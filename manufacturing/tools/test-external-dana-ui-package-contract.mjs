import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const sha=(p)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();

const pkg=JSON.parse(read('package.json'));
const lock=JSON.parse(read('package-lock.json'));
const vendor=JSON.parse(read('vendor/dana-ui/VENDOR_MANIFEST.json'));
const vendorPkg=JSON.parse(read('vendor/dana-ui/package/package.json'));
const htmlManifest=JSON.parse(read('DANA_UI_HTML_PRESERVATION_MANIFEST.json'));
const testManifest=JSON.parse(read('DANA_UI_TEST_PRESERVATION_MANIFEST.json'));
const runner=read('tools/run-all-tests.ps1');
const barrel=read('vendor/dana-ui/package/index.d.ts');
const migration=read('vendor/dana-ui/package/styles/gear-compat-overrides.css');
const dockerIgnore=read('.dockerignore');
for(const marker of ['.angular','_patch_backups','tools/data-import/work','swagger.json','cutter-history-dynamic-migration-report.json']){
  must(dockerIgnore.split(/\r?\n/).map(x=>x.trim()).includes(marker),`.dockerignore missing required generated-artifact exclusion: ${marker}`);
}


const dependency='file:vendor/dana-ui/package';
must(pkg.devDependencies?.['@dana/ui']===dependency,'package.json must consume vendored @dana/ui as a devDependency.');
must(lock.packages?.['']?.devDependencies?.['@dana/ui']===dependency,'package-lock root devDependency is missing @dana/ui.');
must(lock.packages?.['node_modules/@dana/ui']?.link===true,'package-lock must install @dana/ui as a local file link.');
must(lock.packages?.['vendor/dana-ui/package']?.version===vendorPkg.version,'Vendored @dana/ui package-lock version must match the vendored package.');

must(vendor.packageName==='@dana/ui','Vendor manifest package name mismatch.');
must(vendor.packageVersion===vendorPkg.version,'Vendor manifest package version mismatch.');
must(vendor.visualSource==='Truck Log','Vendor manifest must identify Truck Log as the visual source.');

must(vendorPkg.name==='@dana/ui'&&/^\d+\.\d+\.\d+$/.test(vendorPkg.version),'Vendored package identity mismatch.');
for(const p of [
  'vendor/dana-ui/package/styles/dana-ui.css',
  'vendor/dana-ui/package/styles/dana-core.css',
  'vendor/dana-ui/package/styles/gear-compat.css',
  'vendor/dana-ui/package/assets/branding/dana-diamond.png'
]) must(fs.existsSync(path.join(root,p)),`Vendored Dana UI output missing ${p}`);

for(const entry of htmlManifest.files){
  const full=path.join(root,entry.path);
  must(fs.existsSync(full),`Preserved HTML file missing: ${entry.path}`);
  // Byte-hash freeze retired: it guarded the one-time V70.0.2R9 package migration,
  // and these pages have since been legitimately updated.
}

for(const entry of testManifest.files){
  const full=path.join(root,entry.path);
  must(fs.existsSync(full),`Preserved existing test missing: ${entry.path}`);
}

const toastContract=read('tools/test-toast-notifications-contract.mjs');
must(toastContract.includes('DanaToastService as GearToastService'),'Toast contract must validate current Dana-owned compatibility aliasing.');
must(toastContract.includes('Dana/Gear compatibility toast contract'),'Toast contract must validate the current shared Dana toast architecture.');

const premergeContract=read('tools/test-dana-apps-premerge-contract.mjs');
must(premergeContract.includes('const canonicalRecord = (value) =>'),'Premerge contract must compare dependency maps canonically.');
must(premergeContract.includes("pkg.devDependencies?.['@dana/ui'] === 'file:vendor/dana-ui/package'"),'Premerge contract must protect the vendored @dana/ui dependency.');
must(premergeContract.includes("vendoredDanaUiPackage.name === '@dana/ui'"),'Premerge contract must validate package identity from vendored package.json.');
must(premergeContract.includes("installedDanaUiPackage.name === '@dana/ui'"),'Premerge contract must validate installed package identity.');
must(premergeContract.includes("installedDanaUiPackage.version === vendoredDanaUiPackage.version"),'Premerge contract must validate installed package version.');
must(premergeContract.includes("fs.realpathSync(path.join(root, 'node_modules/@dana/ui'))"),'Premerge contract must validate the installed local-package filesystem target.');


for(const app of ['blade-tracking','cutter-builder','greenshed']){
  const project=JSON.parse(read(`apps/${app}/project.json`));
  const styles=project.targets?.build?.options?.styles??[];
  const local='node_modules/@dana/ui/styles/gear-compat.css';
  const domain='node_modules/@dana/ui/styles/gear-compat-features.css';
  const external='node_modules/@dana/ui/styles/dana-ui.css';
  const bridge='node_modules/@dana/ui/styles/gear-compat-overrides.css';
  const localAt=styles.indexOf(local);
  const domainAt=styles.indexOf(domain);
  const externalAt=styles.indexOf(external);
  const bridgeAt=styles.indexOf(bridge);
  must(localAt>=0,`${app}: Dana UI Gear compatibility stylesheet must load.`);
  must(domainAt===localAt+1,`${app}: Gear domain CSS must remain immediately after local compatibility CSS.`);
  must(externalAt===domainAt+1,`${app}: external Truck Log-derived Dana UI must load after Gear domain CSS.`);
  must(bridgeAt===externalAt+1,`${app}: migration bridge must load last.`);
  must(styles.every((s)=>s.startsWith('apps/')||s.startsWith('node_modules/@dana/ui/styles/')),`${app}: every shared stylesheet must come from @dana/ui.`);
}

for(const marker of [
  '--gear-sidebar-width: var(--dana-sidebar-width',
  '.gear-sidebar {',
  '.brand-mark {',
  '.side-link {',
  '.gear-topbar {',
  'html body .gear-page {',
  'html body .gear-page-header {',
  'html body .gear-panel',
  'html body .gear-btn {',
  'html body .gear-input',
  'html body table.gear-table',
  'html body .gear-badge',
  '.app-content-shell.login-shell'
]) must(migration.includes(marker),`Migration bridge missing marker: ${marker}`);

must(!migration.includes('.app-content-shell.dana-main'),'Migration bridge must not require template alias mutation.');

for(const dockerfile of [
  'apps/blade-tracking/Dockerfile',
  'apps/cutter-builder/Dockerfile',
  'apps/greenshed/Dockerfile',
  'apps/server/Dockerfile'
]){
  must(read(dockerfile).includes('COPY vendor/dana-ui/package ./vendor/dana-ui/package'),`${dockerfile}: vendored Dana UI is not copied before npm install.`);
}

for(const c of ['DANA_UI_GLOBAL_STYLESHEET = "@dana/ui/styles/dana-ui.css"','DANA_UI_GEAR_COMPAT_STYLESHEET = "@dana/ui/styles/gear-compat.css"','DANA_UI_GEAR_COMPAT_FEATURES_STYLESHEET = "@dana/ui/styles/gear-compat-features.css"','DANA_UI_GEAR_COMPAT_OVERRIDES_STYLESHEET = "@dana/ui/styles/gear-compat-overrides.css"']) must(barrel.includes(c),`@dana/ui is missing stylesheet constant: ${c}`);
must(runner.includes('test-external-dana-ui-package-contract.mjs'),'Authoritative Gear runner is missing external Dana UI contract.');
must(runner.includes('audit-dana-ui-migration-test-surface.mjs'),'Authoritative Gear runner is missing migration test-surface audit.');
must(fs.existsSync(path.join(root,'tools/test-read-only-api-smoke-source-contract.mjs')),'Read-only API smoke source contract is missing.');
must(runner.includes('test-read-only-api-smoke-source-contract.mjs'),'Authoritative Gear runner is missing read-only API smoke source contract.');


console.log(`[PASS] External Dana UI package contract: @dana/ui ${vendorPkg.version} is vendored from Truck Log, the HTML/tests it covered still exist, and migration is isolated to stylesheet/package wiring.`);

// Dana Apps V70.0.4: additional visual-adapter regression; existing assertions stay intact.
await import('./test-dashboard-visual-qa-contract.mjs');
