import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const read=(p)=>fs.readFileSync(contractPath(process.cwd(), p),'utf8');
const exists=(p)=>fs.existsSync(contractPath(process.cwd(), p));
// A component that extends a base class from its own feature (e.g. RunningMachinesFeed) also owns
// that class's methods, so they count when checking its template's handlers.
const withLocalBaseClass=(file,text)=>{
  const base=text.match(/\bextends\s+([A-Z]\w*)/)?.[1];
  const from=base && text.match(new RegExp(`import\\s*\\{[^}]*\\b${base}\\b[^}]*\\}\\s*from\\s*'(\\.[^']+)'`))?.[1];
  const baseFile=from && path.join(path.dirname(file),`${from}.ts`);
  return baseFile && exists(baseFile) ? `${text}\n${read(baseFile)}` : text;
};

const apps={
  blade:{
    app:'apps/blade-tracking',
    feature:'libs/manufacturing/frontend/feature-blade-tracking',
    base:'/blades',
    routes:['','operations','internal-movement','load-container','coater-shipments','receive-container','tray-contents','intake','inventory','all-inventory','locations','scrap-blades','cancel-last','grinding','body-shelves'],
  },
  cutter:{
    app:'apps/cutter-builder',
    feature:'libs/manufacturing/frontend/feature-cutter-builder',
    base:'/cutter-builder',
    routes:['','build','teardown','lookup','requests','cancel-last'],
  },
  greenshed:{
    app:'apps/greenshed',
    feature:'libs/manufacturing/frontend/feature-greenshed',
    base:'/greenshed',
    routes:['','machines','machines-board','setup','check','pull','lookup','cutter-requests','cancel-last'],
  },
};

// Both restored navigation entry points must remain registered in their feature routes.
if(!/path:\s*'requests'/.test(read('libs/manufacturing/frontend/feature-cutter-builder/src/lib/cutter-builder.routes.ts'))){
  throw new Error('Cutter Builder navigation requires its restored requests route.');
}
if(!/path:\s*'cutter-requests'/.test(read('libs/manufacturing/frontend/feature-greenshed/src/lib/greenshed.routes.ts'))){
  throw new Error('Greenshed navigation requires its restored cutter-requests route.');
}
// The touch board sits beside the Running Machines table; both stay registered.
for (const route of ['machines', 'machines-board']) {
  if(!new RegExp(`path:\\s*'${route}'`).test(read('libs/manufacturing/frontend/feature-greenshed/src/lib/greenshed.routes.ts'))){
    throw new Error(`Greenshed navigation requires its ${route} route.`);
  }
}

function walk(dir,ext,out=[]){
  for(const e of fs.readdirSync(contractPath(process.cwd(), dir),{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory()) walk(p,ext,out);
    else if(e.isFile() && p.endsWith(ext)) out.push(p);
  }
  return out;
}

for(const [name,cfg] of Object.entries(apps)){
  const pageTemplates=walk(path.join(cfg.feature,'src','lib','pages'),'.component.html');
  if(!pageTemplates.length) throw new Error(`${name}: no feature pages found`);

  for(const file of pageTemplates){
    const html=read(file).trimStart();
    if(!/^<(?:div|section)\s+class="[^"]*\bgear-page\b/.test(html)){
      throw new Error(`${name}: page does not use shared gear-page shell: ${file}`);
    }
  }

  const appRoutes=read(`${cfg.app}/src/app/app.routes.ts`);
  if(!appRoutes.includes("path: 'machine-counts'")) throw new Error(`${name}: missing shared DSF route`);
  const valid=new Set([cfg.base,'/admin','/login','/','/machine-counts']);
  for(const r of cfg.routes) if(r) valid.add(`${cfg.base}/${r}`);

  const htmlFiles=[...walk(cfg.app,'.html'),...walk(cfg.feature,'.html')];
  for(const file of htmlFiles){
    const html=read(file);
    for(const m of html.matchAll(/routerLink="([^"]+)"/g)){
      const link=m[1];
      if(link.startsWith('/') && !valid.has(link)){
        throw new Error(`${name}: routerLink points to an undefined app route: ${link} in ${file}`);
      }
    }
  }
}

// Shared shell must be visually and behaviorally aligned.
const navFiles=[
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html',
];
for(const file of navFiles){
  const html=read(file);
  for(const marker of ['gear-sidebar','gear-topbar','global-search','topbar-user','sidebar-footer','Shared manufacturing workspace','v{{ appVersion }}']){
    if(!html.includes(marker)) throw new Error(`${file}: missing shared shell marker ${marker}`);
  }
  if(html.includes('notification-badge')) throw new Error(`${file}: static/mock notification badge must not be shipped`);
}

const bladeNav=read(navFiles[0]);
for(const misleading of ['>Coater History<','>Settings<']){
  if(bladeNav.includes(misleading)) throw new Error(`Blade navigation still exposes a placeholder/misdirected item: ${misleading}`);
}

// Ensure component event handlers and direct ngModel properties exist in their TS class.
for(const cfg of Object.values(apps)){
  const roots=[cfg.app,cfg.feature];
  for(const root of roots){
    for(const htmlFile of walk(root,'.component.html')){
      const tsFile=htmlFile.replace(/\.html$/,'.ts');
      if(!exists(tsFile)) continue;
      const html=read(htmlFile); const ts=withLocalBaseClass(tsFile,read(tsFile));
      for(const m of html.matchAll(/\((?:click|ngSubmit|scanned|change|input|keydown\.enter)\)="\s*([A-Za-z_]\w*)\s*\(/g)){
        if(!new RegExp(`\\b${m[1]}\\s*\\(`).test(ts)){
          throw new Error(`${htmlFile}: template calls missing method ${m[1]}()`);
        }
      }
      for(const m of html.matchAll(/\[?\(ngModel\)\]?="\s*([A-Za-z_]\w*)\s*"/g)){
        if(!new RegExp(`\\b${m[1]}\\b`).test(ts)){
          throw new Error(`${htmlFile}: ngModel targets missing property ${m[1]}`);
        }
      }
      if(html.includes('[(ngModel)]') && !/\bFormsModule\b/.test(ts)){
        throw new Error(`${htmlFile}: uses ngModel but component does not import FormsModule`);
      }
      if((html.includes('routerLink=') || html.includes('[routerLink]')) && !/\bRouterLink\b/.test(ts)){
        throw new Error(`${htmlFile}: uses routerLink but component does not import RouterLink`);
      }
    }
  }
}

// Search shortcuts must be consumed by destination pages.
const cutterNavTs=read('apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.ts');
const cutterLookupTs=read('libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/lookup/cutter-lookup.component.ts');
if(!cutterNavTs.includes("queryParams: { build: value }") || !cutterLookupTs.includes("queryParamMap.get('build')")){
  throw new Error('Cutter Builder top-bar search query parameter is not wired end to end.');
}
const greenNavTs=read('apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.ts');
const greenLookupTs=read('libs/manufacturing/frontend/feature-greenshed/src/lib/pages/lookup/greenshed-lookup.component.ts');
if(!greenNavTs.includes("queryParams: { build: value }") || !greenLookupTs.includes("queryParamMap.get('build')")){
  throw new Error('Greenshed top-bar search query parameter is not wired end to end.');
}

console.log('[PASS] Deep UI contract: page shells, routes, navs, handlers, ngModel imports, and search wiring are consistent.');
