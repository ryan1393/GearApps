import fs from 'node:fs';
import path from 'node:path';
import { contractPath, manufacturingRoot, workspaceRoot, readContract } from './lib/contract-paths.mjs';
const must = (ok,message) => { if(!ok)throw new Error(message); };
const json = file => JSON.parse(readContract(file));
const pkg=json('package.json'), lock=json('package-lock.json');
const vendor=json('vendor/dana-ui/VENDOR_MANIFEST.json'), vendorPkg=json('vendor/dana-ui/package/package.json'), installed=json('node_modules/@dana/ui/package.json');
const dependency='file:vendor/dana-ui/package';
must(pkg.devDependencies?.['@dana/ui']===dependency && lock.packages?.['']?.devDependencies?.['@dana/ui']===dependency,'The root lockfile must pin the sole vendored Dana UI package');
must(lock.packages?.['node_modules/@dana/ui']?.link===true,'Dana UI must be a root local-package link');
must(vendor.packageName==='@dana/ui' && vendorPkg.name==='@dana/ui' && installed.name==='@dana/ui','Dana UI identity mismatch');
must(installed.version===vendorPkg.version && vendor.packageVersion===vendorPkg.version,'Dana UI release versions differ');
must(lock.packages?.['vendor/dana-ui/package']?.version===vendorPkg.version,'The root lock records a different Dana UI version');
must(fs.realpathSync(contractPath(manufacturingRoot,'node_modules/@dana/ui'))===fs.realpathSync(contractPath(manufacturingRoot,'vendor/dana-ui/package')),'Installed Dana UI is not the shared root output');
must(!fs.existsSync(path.join(manufacturingRoot,'vendor/dana-ui/package')),'Remove the duplicate manufacturing Dana UI output');
for (const path of ['styles/dana-ui.css','styles/dana-core.css','styles/gear-compat.css','styles/gear-compat-features.css','styles/gear-compat-overrides.css','assets/branding/dana-diamond.png']) must(fs.existsSync(contractPath(manufacturingRoot,'vendor/dana-ui/package',path)),`Dana UI output missing: ${path}`);
for (const manifest of ['DANA_UI_HTML_PRESERVATION_MANIFEST.json','DANA_UI_TEST_PRESERVATION_MANIFEST.json']) {
  for(const entry of json(manifest).files) must(fs.existsSync(contractPath(process.cwd(), path.join(manufacturingRoot,entry.path))),`Preserved source missing: ${entry.path}`);
}
for(const app of ['blade-tracking','cutter-builder','greenshed']) {
  const styles=json(`apps/${app}/project.json`).targets?.build?.options?.styles??[];
  const expected=['gear-compat.css','gear-compat-features.css','dana-ui.css','gear-compat-overrides.css'].map(name=>'libs/shared/dana-ui/src/styles/'+name);
  const start=styles.indexOf(expected[0]);
  must(start>=0 && expected.every((name,index)=>styles[start+index]===name),`${app}: shared Dana compatibility ordering changed`);
  must(styles.every(name=>name===`apps/${app}/src/styles.css` || name.startsWith('libs/shared/dana-ui/src/styles/')),`${app}: local visual design escaped Dana UI ownership`);
}
const barrel=readContract('vendor/dana-ui/package/index.d.ts');
for(const marker of ['DANA_UI_GLOBAL_STYLESHEET','DANA_UI_GEAR_COMPAT_STYLESHEET','DANA_UI_GEAR_COMPAT_FEATURES_STYLESHEET','DANA_UI_GEAR_COMPAT_OVERRIDES_STYLESHEET']) must(barrel.includes(marker),`Dana UI stylesheet export missing ${marker}`);
console.log(`[PASS] One root Dana UI ${vendorPkg.version} is shared across Lapper and manufacturing; source/test preservation and style ownership verified.`);
await import('./test-dashboard-visual-qa-contract.mjs');
