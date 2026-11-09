import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const walk=(dir)=>fs.existsSync(dir)
  ? fs.readdirSync(dir,{withFileTypes:true}).flatMap(ent=>{
      const p=path.join(dir,ent.name);
      return ent.isDirectory()?walk(p):[p];
    })
  : [];

const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const runAll=fs.readFileSync(path.join(root,'tools','run-all-tests.ps1'),'utf8');
const scriptText=JSON.stringify(pkg.scripts??{});

const testFiles=walk(path.join(root,'tools'))
  .filter(p=>/^test-.*\.mjs$/i.test(path.basename(p)))
  .sort((a,b)=>a.localeCompare(b));

const migrationMarkers=[
  'app-nav.component.html','cutter-builder-nav.component.html','greenshed-nav.component.html',
  'gear-apps.css','project.json','package.json','package-lock.json','run-all-tests.ps1',
  'ui-tailwind/src/index.ts','brand-mark','side-link','nav-heading','gear-page',
  'gear-panel','gear-btn','gear-table','gear-sidebar','gear-topbar'
];

const dbRiskPatterns=[
  /from\s+['"]pg['"]/,
  /require\(['"]pg['"]\)/,
  /\bDATABASE_HOST\b/,
  /\bDATABASE_URL\b/,
  /\bnew\s+DataSource\b/,
  /ensure-automatic-test-user/,
  /ensure-backend-mutation-test-fixtures/,
  /ensure-workflow-test-fixtures/
];

const rows=testFiles.map(file=>{
  const text=fs.readFileSync(file,'utf8');
  const rel=path.relative(root,file).replace(/\\/g,'/');
  const base=path.basename(rel);
  const markers=migrationMarkers.filter(marker=>text.includes(marker));
  const exactClassChecks=(text.match(/class=(?:\\?["'])/g)||[]).length +
    (text.match(/includes\(\s*[`'"][^`'"]*class=/g)||[]).length;
  const dbRisk=dbRiskPatterns.some(pattern=>pattern.test(text));
  const authoritative=runAll.includes(base)||scriptText.includes(rel)||scriptText.includes(base);
  return {
    file:rel,
    migrationMarkers:markers,
    exactClassChecks,
    migrationSensitive:markers.length>0||exactClassChecks>0,
    authoritative,
    dbRisk
  };
});

const migrationSensitive=rows.filter(row=>row.migrationSensitive);
const staticAuthoritative=migrationSensitive.filter(row=>row.authoritative&&!row.dbRisk);
const orphaned=migrationSensitive.filter(row=>!row.authoritative);

const dependencyTrim=rows.find(row=>row.file==='tools/test-dependency-trim-contract.mjs');
if(!dependencyTrim)throw new Error('Historical dependency-trim contract is missing from audit inventory.');
if(dependencyTrim.authoritative)throw new Error('Stale dependency-trim contract unexpectedly became authoritative; review it before running.');
if(!orphaned.some(row=>row.file==='tools/test-dependency-trim-contract.mjs')){
  throw new Error('Stale dependency-trim contract must be quarantined as orphaned.');
}

for(const rel of [
  'tools/test-dana-diamond-brand-contract.mjs',
  'tools/test-sidebar-navigation-hierarchy-contract.mjs',
  'tools/test-global-professional-ui-contract.mjs',
  'tools/test-shared-ui-style-source-contract.mjs',
  'tools/test-ui-consistency-contract.mjs',
  'tools/test-ui-deep-scan-contract.mjs',
  'tools/test-ux-responsive-navigation-contract.mjs',
  'tools/test-toast-notifications-contract.mjs',
  'tools/test-dana-apps-premerge-contract.mjs',
  'tools/test-dana-apps-gear-merge-manifest-contract.mjs'
]){
  const row=rows.find(item=>item.file===rel);
  if(!row)throw new Error(`Expected migration contract missing: ${rel}`);
  if(!row.authoritative)throw new Error(`Expected migration contract is not authoritative: ${rel}`);
}

const report={
  schemaVersion:2,
  danaAppsRelease:'V70.0.2R9',
  totalTests:rows.length,
  authoritativeTests:rows.filter(row=>row.authoritative).length,
  migrationSensitiveTests:migrationSensitive.length,
  staticMigrationSensitiveTests:staticAuthoritative.map(row=>row.file),
  dbDeferredMigrationSensitiveTests:migrationSensitive.filter(row=>row.authoritative&&row.dbRisk).map(row=>row.file),
  orphanedMigrationSensitiveTests:orphaned.map(row=>row.file),
  exactClassSensitiveTests:migrationSensitive.filter(row=>row.exactClassChecks>0).map(row=>row.file),
  rows
};

fs.writeFileSync('DANA_UI_MIGRATION_TEST_SURFACE.json',JSON.stringify(report,null,2)+'\n');

if(rows.length<50)throw new Error(`Expected at least 50 Gear test contracts; found ${rows.length}.`);
if(staticAuthoritative.length<12)throw new Error(`Authoritative migration-sensitive static test audit unexpectedly small: ${staticAuthoritative.length}.`);

console.log(`[PASS] Dana UI migration test-surface audit: ${rows.length} tests scanned, ${report.authoritativeTests} authoritative, ${staticAuthoritative.length} static migration-sensitive tests queued.`);
console.log(`[SKIP] Orphaned migration-sensitive tests are inventoried but not executed: ${orphaned.map(row=>row.file).join(', ') || 'none'}`);
