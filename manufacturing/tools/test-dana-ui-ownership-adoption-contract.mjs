import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(rel)=>fs.readFileSync(contractPath(root,rel),'utf8').replace(/^\uFEFF/,'');
const must=(ok,msg)=>{if(!ok) throw new Error(msg)};
const sharedEntry=read('vendor/dana-ui/package/styles/gear-apps.css');
const gearEntry=read('vendor/dana-ui/package/styles/gear-compat-features.css');
const moved=['blade-dashboard.css','cutter-builder.css','greenshed-running-machines.css','inventory-core.css','inventory-relations.css','scrap-blades.css'];
for(const name of moved){
  must(!sharedEntry.includes(`/features/${name}`),`gear-apps.css must not import Gear workflow CSS (it belongs in gear-compat-features.css): ${name}`);
  must(!read('vendor/dana-ui/package/styles/dana-ui.css').includes(name),`dana-ui.css (Truck Log) must not import ${name}`);
  must(gearEntry.includes(`./gear-apps/features/${name}`),`Dana UI gear-compat-features.css does not import ${name}`);
  // Since Dana UI 0.3.0 Gear owns no CSS: Gear workflow styles live in Dana UI's optional Gear layer,
  // never in the canonical dana-ui.css that Truck Log loads.
  must(fs.existsSync(contractPath(root,'vendor/dana-ui/package/styles/gear-apps/features',name)),`Dana UI Gear layer is missing: ${name}`);
}
for(const project of ['blade-tracking','cutter-builder','greenshed']){
  const cfg=JSON.parse(read(`apps/${project}/project.json`)); const styles=cfg?.targets?.build?.options?.styles??[];
  const shared=styles.indexOf('libs/shared/dana-ui/src/styles/gear-compat.css'); const gear=styles.indexOf('libs/shared/dana-ui/src/styles/gear-compat-features.css');
  must(shared>=0,`${project} lost Dana shared stylesheet`); must(gear===shared+1,`${project} must load Gear feature styles immediately after Dana shared styles`);
}
const ts=read('libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.ts');
const html=read('libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html');
must(ts.includes('DanaButtonDirective')&&ts.includes('DanaAlertDirective'),'Blade Locations shared primitive imports missing');
must(html.includes('danaButton="secondary"'),'Blade Locations refresh action is not using DanaButton');
must(html.includes('danaAlert="danger"')&&html.includes('danaAlert="success"'),'Blade Locations feedback is not using DanaAlert');
console.log('[PASS] Dana UI ownership/adoption contract: 6 Gear workflow styles are Gear-owned, 3 apps layer them after Dana shared UI, and Blade Locations adopts Dana button/alert primitives.');
