import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg);};

const pkg=JSON.parse(read('package.json'));
const canonical=read('src/styles/dana-ui.css');
const core=read('src/styles/dana-core.css');
const tokens=read('src/styles/dana-core/tokens.css');
const shell=read('src/styles/dana-core/shell.css');
const primitives=read('src/styles/dana-core/primitives.css');
const tables=read('src/styles/dana-core/tables.css');
const forms=read('src/styles/dana-core/forms.css');
const manifest=JSON.parse(read('TRUCK_LOG_VISUAL_SOURCE.json'));
const finalizer=read('tools/finalize-package.mjs');

must(/^\d+\.\d+\.\d+$/.test(pkg.version),'@dana/ui package version must be semver.');
must(canonical.includes("@import './dana-core.css'"),'Canonical Dana UI must import dana-core.css.');
must(!canonical.includes('gear-compat.css'),'Canonical Dana UI must not import Gear compatibility.');
must(!/gear-/i.test(core),'Dana core entry must not reference Gear.');
must(!/gear-/i.test(tokens+shell+primitives+tables+forms),'Dana neutral core contains a Gear marker.');

must(manifest.visualSource==='Truck Log','Visual source manifest must identify Truck Log.');
must(Array.isArray(manifest.files)&&manifest.files.length>=5,'Truck Log visual source manifest is incomplete.');
must(manifest.files.every(x=>/^[A-F0-9]{64}$/.test(x.sha256)),'Truck Log source SHA manifest contains an invalid hash.');
must(manifest.resolvedTokens&&typeof manifest.resolvedTokens==='object','Truck Log resolved visual-token manifest is missing.');

const map={
  text:'--dana-text',muted:'--dana-muted',border:'--dana-border',page:'--dana-page',
  surface:'--dana-surface',success:'--dana-success',warning:'--dana-warning',
  danger:'--dana-danger',primary:'--dana-primary',primaryDark:'--dana-primary-dark',
  sidebar:'--dana-sidebar',sidebarRaised:'--dana-sidebar-raised',
  radiusSm:'--dana-radius-sm',radiusMd:'--dana-radius-md',radiusLg:'--dana-radius-lg',
  radiusXl:'--dana-radius-xl',sidebarWidth:'--dana-sidebar-width',
  topbarHeight:'--dana-topbar-height',contentPad:'--dana-content-pad',contentMax:'--dana-content-max'
};

const compact=tokens.replace(/\s/g,'');
for(const [key,cssName] of Object.entries(map)){
  const value=String(manifest.resolvedTokens[key]??'').replace(/\s/g,'');
  must(value.length>0,`Resolved Truck Log visual token is empty: ${key}`);
  must(compact.includes(`${cssName}:${value};`),`Dana token ${cssName} does not match current Truck Log resolved value ${manifest.resolvedTokens[key]}.`);
}

for(const marker of [
  'radial-gradient(circle at 12% 8%',
  'width: var(--dana-sidebar-width)',
  'height: var(--dana-topbar-height)',
  'max-width: var(--dana-content-max)'
]) must(shell.includes(marker),`Truck Log shell marker missing: ${marker}`);

must(primitives.includes('font-size: 28px'),'Truck Log page-heading scale missing.');
must(primitives.includes('border-radius: 10px'),'Truck Log control radius missing.');
must(tables.includes('background: #fbfcfe'),'Truck Log table header surface missing.');
must(compact.includes('--dana-radius-field:9px;') && forms.includes('border-radius: var(--dana-radius-field)'),'Truck Log field radius missing.');
must(finalizer.includes("pkg.exports['./styles/dana-core.css']"),'Built package export for dana-core.css is missing.');

console.log(`[PASS] Dana UI Truck Log visual-source contract: ${manifest.files.length} Truck Log source files hash-pinned and current resolved visual tokens match Dana UI.`);
