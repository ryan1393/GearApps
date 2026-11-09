import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const source=JSON.parse(fs.readFileSync(path.join(root,'TRUCK_LOG_VISUAL_SOURCE.json'),'utf8'));
const files=[
  'src/styles/dana-core.css',
  'src/styles/dana-core/tokens.css',
  'src/styles/dana-core/base.css',
  'src/styles/dana-core/icons.css',
  'src/styles/dana-core/shell.css',
  'src/styles/dana-core/primitives.css',
  'src/styles/dana-core/forms.css',
  'src/styles/dana-core/tables.css',
  'src/styles/dana-core/feedback.css',
  'src/styles/dana-core/responsive.css'
];

const rows=files.map(rel=>{
  const text=fs.readFileSync(path.join(root,rel),'utf8');
  return {
    file:rel,
    danaSelectors:(text.match(/\.dana-/g)||[]).length,
    danaTokens:(text.match(/--dana-/g)||[]).length,
    gearMarkers:(text.match(/gear-/gi)||[]).length
  };
});

const report={
  danaUiVersion:JSON.parse(fs.readFileSync('package.json','utf8')).version,
  visualSource:'Truck Log',
  truckLogSourceFiles:source.files.length,
  files:rows,
  totals:{
    danaSelectors:rows.reduce((n,x)=>n+x.danaSelectors,0),
    danaTokens:rows.reduce((n,x)=>n+x.danaTokens,0),
    gearMarkers:rows.reduce((n,x)=>n+x.gearMarkers,0)
  }
};
fs.writeFileSync('DANA_UI_TRUCK_LOG_VISUAL_AUDIT.json',JSON.stringify(report,null,2)+'\n');
if(report.totals.gearMarkers)throw new Error('Dana neutral core contains Gear markers.');
console.log(`[PASS] Truck Log visual audit: ${report.truckLogSourceFiles} source files pinned, ${report.totals.danaSelectors} Dana selectors, 0 Gear markers.`);
