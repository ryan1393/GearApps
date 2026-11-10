import fs from 'node:fs';
import path from 'node:path';
import { contractPath, workspaceRoot, readContract } from './lib/contract-paths.mjs';
import { danaUiPublicApiText } from './lib/dana-ui-source.mjs';
const must = (ok,message) => { if(!ok)throw new Error(message); };
const json = file => JSON.parse(readContract(file));
const pkg=json('package.json'), lock=json('package-lock.json');
const ui=json('libs/shared/dana-ui/package.json');
must(ui.name==='@dana/ui','Dana UI identity mismatch');
// One copy: applications compile libs/shared/dana-ui through the @dana/ui path alias; no built
// package is vendored or installed.
for (const kind of ['dependencies','devDependencies']) {
  must(pkg[kind]?.['@dana/ui']===undefined && lock.packages?.['']?.[kind]?.['@dana/ui']===undefined,`Do not install a separate @dana/ui package (${kind})`);
}
must(!lock.packages?.['node_modules/@dana/ui'] && !Object.keys(lock.packages??{}).some(name=>name.startsWith('vendor/')),'The lockfile must not record a vendored Dana UI package');
must(!fs.existsSync(path.join(workspaceRoot,'vendor')),'Remove the vendored Dana UI copy; libs/shared/dana-ui is the only source');
must(JSON.stringify(json('tsconfig.base.json').compilerOptions.paths['@dana/ui'])===JSON.stringify(['./libs/shared/dana-ui/src/index.ts']),'@dana/ui must resolve to the libs/shared/dana-ui source');
for (const path of ['styles/dana-ui.css','styles/dana-core.css','styles/gear-compat.css','styles/gear-compat-features.css','styles/gear-compat-overrides.css','assets/branding/dana-diamond.png']) must(fs.existsSync(contractPath(workspaceRoot,'libs/shared/dana-ui/src',path)),`Dana UI source missing: ${path}`);
for (const manifest of ['docs/manufacturing/DANA_UI_HTML_PRESERVATION_MANIFEST.json','docs/manufacturing/DANA_UI_TEST_PRESERVATION_MANIFEST.json']) {
  for(const entry of json(manifest).files) must(fs.existsSync(contractPath(process.cwd(), path.join(workspaceRoot,entry.path))),`Preserved source missing: ${entry.path}`);
}
for(const app of ['blade-tracking','cutter-builder','greenshed']) {
  const styles=json(`apps/${app}/project.json`).targets?.build?.options?.styles??[];
  const expected=['gear-compat.css','gear-compat-features.css','dana-ui.css','gear-compat-overrides.css'].map(name=>'libs/shared/dana-ui/src/styles/'+name);
  const start=styles.indexOf(expected[0]);
  must(start>=0 && expected.every((name,index)=>styles[start+index]===name),`${app}: shared Dana compatibility ordering changed`);
  must(styles.every(name=>name===`apps/${app}/src/styles.css` || name.startsWith('libs/shared/dana-ui/src/styles/')),`${app}: local visual design escaped Dana UI ownership`);
}
const barrel=danaUiPublicApiText();
for(const marker of ['DANA_UI_GLOBAL_STYLESHEET','DANA_UI_GEAR_COMPAT_STYLESHEET','DANA_UI_GEAR_COMPAT_FEATURES_STYLESHEET','DANA_UI_GEAR_COMPAT_OVERRIDES_STYLESHEET']) must(barrel.includes(marker),`Dana UI stylesheet export missing ${marker}`);
console.log(`[PASS] One Dana UI ${ui.version} source is shared across Lapper and manufacturing; source/test preservation and style ownership verified.`);
await import('./test-dashboard-visual-qa-contract.mjs');
