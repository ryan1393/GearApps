import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const must=(ok,msg)=>{if(!ok)throw new Error(msg);};
const walk=(dir)=>{
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(ent=>{
    const p=path.join(dir,ent.name);
    return ent.isDirectory()?walk(p):[p];
  });
};

const tsFiles=walk(path.join(root,'src','lib')).filter(p=>p.endsWith('.ts'));
must(tsFiles.length>=20,'Dana UI source extraction looks incomplete.');

const allowed=new Set(['@angular/core','@angular/common','@angular/forms','rxjs']);
for(const file of tsFiles){
  const text=fs.readFileSync(file,'utf8');
  const imports=[...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m=>m[1]);
  for(const spec of imports){
    if(spec.startsWith('.'))continue;
    must(allowed.has(spec),'Boundary violation in '+path.relative(root,file)+': '+spec);
  }
  must(!text.includes('@libs/'),'Dana UI may not import application workspace aliases.');
}

const index=fs.readFileSync(path.join(root,'src','index.ts'),'utf8');
for(const name of [
  'DanaPageHeaderComponent','DanaOperationCardComponent','DanaTableDirective',
  'DanaTableShellDirective','DanaButtonDirective','DanaIconButtonDirective',
  'DanaToolbarDirective','DanaAlertDirective','DanaDetailGridDirective',
  'DanaTabsDirective','DanaToastService','DanaConfirmDialogComponent',
  'DanaMobileNavDirective','DanaResponsiveGridDirective','DanaStackDirective','DanaComboboxComponent'
]){
  must(index.includes(name),'Public API missing '+name);
}
must(index.includes('DANA_UI_GLOBAL_STYLESHEET'),'Dana stylesheet public constant missing.');
must(fs.existsSync(path.join(root,'src','styles','dana-ui.css')),'dana-ui.css missing.');

const all=walk(path.join(root,'src'))
  .filter(p=>/\.(ts|css|js)$/.test(p))
  .map(p=>fs.readFileSync(p,'utf8')).join('\n');
const legacy=(all.match(/gear-/g)||[]).length;

console.log('[PASS] Dana UI boundary contract: '+tsFiles.length+' TypeScript UI files are app-independent.');
console.log('[INFO] Legacy gear-* compatibility markers retained: '+legacy);
