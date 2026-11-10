import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readContract, workspaceRoot } from './lib/contract-paths.mjs';
const sourceRoot=path.join(workspaceRoot,'libs/shared/dana-ui/src');
const source=fs.readFileSync(contractPath(process.cwd(), path.join(sourceRoot,'index.ts')),'utf8');
const declarations=readContract('vendor/dana-ui/package/index.d.ts');
const exports=[...source.matchAll(/export(?:\s+type)?\s+(?:\{[^}]+\}|\*)\s+from\s+['"](\.\/[^'"]+)['"]/g)].map(match=>match[1]);
if(exports.length<20) throw new Error(`Shared UI source barrel export scan was unexpectedly small: ${exports.length}`);
for(const spec of exports) {
 const base=path.resolve(sourceRoot,spec);
 if(![base+'.ts',path.join(base,'index.ts')].some(file=>fs.existsSync(contractPath(process.cwd(), file)))) throw new Error(`Shared UI source export does not resolve: ${spec}`);
}
// Angular 20 ng-packagr emits flattened declarations. Check public symbols,
// rather than requiring the old compiler's private per-component .d.ts layout.
const publicExports=[...declarations.matchAll(/export\s*\{([^}]+)\}/g)].map(match=>match[1]).join(' ');
for(const [name,file] of [
 ['DanaTabsDirective','dana-tabs.directive'],['DanaTabDirective','dana-tab.directive'],
 ['DanaToastHostComponent','dana-toast-host.component'],['DanaToastService','dana-toast.service'],
 ['DanaConfirmDialogComponent','dana-confirm-dialog.component'],['DanaTableDirective','dana-table.directive'],
 ['DanaComboboxComponent','dana-combobox.component'],
]) {
 if(!new RegExp(`\\b${name}\\b`).test(publicExports)) throw new Error(`Shared UI public declaration missing: ${name}`);
 if(!exports.some(spec=>spec.endsWith('/'+file))) throw new Error(`Shared UI source barrel missing: ${file}`);
}

console.log(`[PASS] Dana shared UI source exports resolve (${exports.length}) and flattened public declarations preserve the component API.`);
