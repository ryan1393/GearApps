import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {
  GEAR_APPS_STYLE_ENTRY_INSTALLED,
  GEAR_APPS_DOMAIN_STYLE_ENTRY_INSTALLED,
  GEAR_APPS_STYLE_ENTRY,
  GEAR_APPS_DOMAIN_STYLE_ENTRY,
  listGearAppsStyleModules,
  listGearAppsDomainStyleModules,
  readGearAppsStyles,
} from './lib/read-gear-apps-styles.mjs';

const root=process.cwd();
const must=(ok,msg)=>{if(!ok) throw new Error(msg)};
const sharedStyle=GEAR_APPS_STYLE_ENTRY;
const domainStyle=GEAR_APPS_DOMAIN_STYLE_ENTRY;
const factory='../../manufacturing/tools/tailwind/create-app-tailwind-config';
const moved=['blade-dashboard.css','cutter-builder.css','greenshed-running-machines.css','greenshed-running-machines-typography.css','greenshed-running-machines-colors.css','greenshed-running-machines-counts.css','inventory-core.css','inventory-relations.css','scrap-blades.css'];
const criticalOrder=[
  'foundation/tokens.css','foundation/base.css','layout/app-shell.css',
  'components/primitives.css','components/data-display.css','components/icons.css',
  'layout/navigation-shell.css','layout/brand.css','foundation/responsive.css',
];
const sharedStyleFile=contractPath(root,sharedStyle);
const domainStyleFile=contractPath(root,domainStyle);
must(fs.existsSync(contractPath(process.cwd(), sharedStyleFile)),'Dana shared stylesheet entry point is missing.');
must(fs.existsSync(contractPath(process.cwd(), domainStyleFile)),'Gear domain stylesheet entry point is missing.');

function assertImportOnly(file,label){
  const entry=fs.readFileSync(contractPath(process.cwd(), file),'utf8');
  const declarations=entry.replace(/\/\*[\s\S]*?\*\//g,'').replace(/@import\s+['"][^'"]+['"]\s*;/g,'').trim();
  must(!declarations,`${label} must remain an import-only entry point.`);
}
assertImportOnly(sharedStyleFile,'Dana shared stylesheet');
assertImportOnly(domainStyleFile,'Gear domain stylesheet');

const sharedModules=listGearAppsStyleModules(root);
const domainModules=listGearAppsDomainStyleModules(root);
must(sharedModules.length>=12,`Dana shared style graph is unexpectedly small (${sharedModules.length} modules).`);
must(domainModules.length===moved.length,`Gear domain style graph must contain exactly ${moved.length} migrated workflow modules; found ${domainModules.length}.`);
const domainNames=domainModules.map(p=>path.basename(p));
must(JSON.stringify(domainNames)===JSON.stringify(moved),`Gear domain stylesheet order changed unexpectedly. Expected: ${moved.join(', ')} Actual: ${domainNames.join(', ')}`);
for(const name of moved){
  must(!sharedModules.some(p=>p.endsWith('/'+name)),`Dana shared graph still owns Gear workflow module ${name}.`);
  must(domainModules.some(p=>p.endsWith('/'+name)),`Gear domain graph is missing migrated workflow module ${name}.`);
}
const duplicate=new Set(sharedModules.filter(p=>domainModules.includes(p)));
must(duplicate.size===0,`Dana/Gear style ownership overlaps: ${[...duplicate].join(', ')}`);
for(const rel of [...sharedModules,...domainModules]){
  const absolute=contractPath(root,rel); must(fs.existsSync(contractPath(process.cwd(), absolute)),`Style module is missing: ${rel}`);
  const css=fs.readFileSync(contractPath(process.cwd(), absolute),'utf8');
  must(!/@import\s+['"]/.test(css),`${rel}: nested imports are not allowed; entry points own module order.`);
  const lines=css.split(/\r?\n/).length; must(lines<=520,`${rel}: ${lines} lines exceeds the 520-line modular ceiling.`);
}
let last=-1;
for(const suffix of criticalOrder){
  const i=sharedModules.findIndex(p=>p.endsWith('/'+suffix));
  must(i>=0,`Dana shared graph missing critical module ${suffix}.`);
  must(i>last,`Dana critical module order is invalid around ${suffix}.`); last=i;
}

const combined=readGearAppsStyles(root);
for(const marker of ['GEAR APPS DESIGN SYSTEM','--gear-sidebar-width','.gear-sidebar','.gear-topbar','.gear-page','.gear-panel','.gear-btn','.gear-table','.login-page','.running-machines-page','.inventory-overview-kpis','.scrap-history-timeline']){
  must(combined.includes(marker),`Combined Dana/Gear style graph missing ${marker}`);
}

const appsDir=contractPath(root,'apps');
const frontendApps=fs.readdirSync(contractPath(process.cwd(), appsDir),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).filter(name=>{
  const file=path.join(appsDir,name,'project.json'); if(!fs.existsSync(contractPath(process.cwd(), file))) return false;
  const project=JSON.parse(fs.readFileSync(contractPath(process.cwd(), file),'utf8')); const tags=new Set(project.tags??[]);
  return project.projectType==='application'&&tags.has('scope:frontend')&&tags.has('framework:angular');
});
must(frontendApps.length>=3,'Expected the Gear Apps Angular frontends to be discoverable.');
for(const app of frontendApps){
  const projectFile=contractPath(root,'apps',app,'project.json'); const project=JSON.parse(fs.readFileSync(contractPath(process.cwd(), projectFile),'utf8'));
  const sourceRoot=project.sourceRoot||`apps/${app}/src`; const appStyle=`${sourceRoot}/styles.css`; const styles=project.targets?.build?.options?.styles??[];
  const sharedIndex=styles.indexOf(GEAR_APPS_STYLE_ENTRY_INSTALLED),domainIndex=styles.indexOf(GEAR_APPS_DOMAIN_STYLE_ENTRY_INSTALLED),appIndex=styles.indexOf(appStyle);
  // Gear owns no CSS: every stylesheet an app loads must come from @dana/ui.
  for(const entry of styles) must(entry===appStyle||entry.startsWith('libs/shared/dana-ui/src/styles/'),`${app}: loads a stylesheet that is not from @dana/ui: ${entry}`);
  must(sharedIndex===appIndex+1,`${app}: Dana shared style entry must load immediately after Tailwind.`);
  must(domainIndex===sharedIndex+1,`${app}: Gear domain styles must load immediately after Dana shared UI.`);
  for(const modulePath of [...sharedModules,...domainModules]) must(!styles.includes(modulePath),`${app}: must not import style module directly (${modulePath}).`);
  const local=fs.readFileSync(contractPath(root,appStyle),'utf8');
  for(const directive of ['@tailwind base;','@tailwind components;','@tailwind utilities;']) must(local.includes(directive),`${app}: local style entry missing ${directive}`);
  const tw=fs.readFileSync(contractPath(root,'apps',app,'tailwind.config.js'),'utf8'); must(tw.includes(factory),`${app}: Tailwind does not use the central config factory.`);
}
const loginPath=contractPath(root,'libs/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.scss');
if(fs.existsSync(contractPath(process.cwd(), loginPath))) must(!fs.readFileSync(contractPath(process.cwd(), loginPath),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').trim(),'Login component still owns styling.');
console.log(`[PASS] Dana/Gear modular styling contract passed: ${sharedModules.length} Dana modules + ${domainModules.length} Gear-domain modules across ${frontendApps.length} Angular frontends.`);
