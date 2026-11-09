import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const walk=(dir)=>fs.existsSync(dir)
  ? fs.readdirSync(dir,{withFileTypes:true}).flatMap(ent=>{
      const p=path.join(dir,ent.name);
      return ent.isDirectory()?walk(p):[p];
    })
  : [];

const files=walk(path.join(root,'src')).filter(p=>/\.(css|ts)$/.test(p));
const rows=[];
for(const file of files){
  const text=fs.readFileSync(file,'utf8');
  const gear=(text.match(/\bgear-/g)||[]).length;
  const domain=(text.match(/\b(inventory|blade|cutter|greenshed|grinding|shelf|tray)-/gi)||[]).length;
  if(gear||domain){
    rows.push({
      file:path.relative(root,file).replace(/\\/g,'/'),
      gearMarkers:gear,
      domainMarkers:domain
    });
  }
}
rows.sort((a,b)=>(b.gearMarkers+b.domainMarkers)-(a.gearMarkers+a.domainMarkers)||a.file.localeCompare(b.file));

const summary={
  danaUiVersion:JSON.parse(fs.readFileSync('package.json','utf8')).version,
  canonicalVisualSource:'Truck Log',
  scannedFiles:files.length,
  compatibilityFiles:rows.length,
  gearMarkers:rows.reduce((n,r)=>n+r.gearMarkers,0),
  domainMarkers:rows.reduce((n,r)=>n+r.domainMarkers,0),
  files:rows
};

fs.writeFileSync('DANA_UI_COMPATIBILITY_AUDIT.json',JSON.stringify(summary,null,2)+'\n');
console.log('[PASS] Dana UI compatibility audit written.');
console.log('[INFO] Compatibility-bearing files: '+summary.compatibilityFiles);
console.log('[INFO] gear-* markers: '+summary.gearMarkers);
console.log('[INFO] domain markers: '+summary.domainMarkers);
