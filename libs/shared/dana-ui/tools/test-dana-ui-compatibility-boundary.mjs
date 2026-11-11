import fs from 'node:fs';

const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const canonical=fs.readFileSync('src/styles/dana-ui.css','utf8');
const core=fs.readFileSync('src/styles/dana-core.css','utf8');
const compat=fs.readFileSync('src/styles/gear-compat.css','utf8');
const packageJson=JSON.parse(fs.readFileSync('package.json','utf8'));
const finalizer=fs.readFileSync('tools/finalize-package.mjs','utf8');
const docs=fs.readFileSync('DANA_UI_COMPATIBILITY.md','utf8');
const source=JSON.parse(fs.readFileSync('TRUCK_LOG_VISUAL_SOURCE.json','utf8'));

must(/^\d+\.\d+\.\d+$/.test(packageJson.version),'@dana/ui package version must be semver.');
must(canonical.includes("@import './dana-core.css'"),'Canonical Dana UI must import the neutral core.');
must(!canonical.includes('gear-compat.css'),'Canonical Dana UI must not import Gear compatibility ');
must(!/gear-/i.test(core),'Dana neutral core entry may not reference Gear.');
must(compat.includes("@import './gear-apps.css'"),'gear-compat.css must continue owning the legacy Gear stylesheet import.');
must(source.visualSource==='Truck Log','Dana UI visual source must be Truck Log.');
must(source.resolvedTokens&&Object.keys(source.resolvedTokens).length>=10,'Truck Log resolved-token manifest is missing.');

must(docs.includes('Truck Log must **not** depend on `gear-compat.css`'),'Truck Log compatibility boundary documentation is missing.');
must(docs.includes('MeshForge may import `gear-compat.css` explicitly'),'Gear migration rule is missing.');
must(docs.includes('New reusable components, selectors, tokens, and public APIs must use `dana-*` naming.'),'Dana-neutral naming rule is missing.');

must(finalizer.includes("pkg.exports['./styles/gear-compat.css']"),'Packaged Gear compatibility stylesheet export is missing.');
must(finalizer.includes("pkg.exports['./styles/dana-ui.css']"),'Canonical Dana stylesheet export is missing.');
must(finalizer.includes("pkg.exports['./styles/dana-core.css']"),'Dana core stylesheet export is missing.');

console.log('[PASS] Dana UI compatibility boundary: Truck Log-derived core is canonical and Gear compatibility remains an explicit optional migration surface.');
