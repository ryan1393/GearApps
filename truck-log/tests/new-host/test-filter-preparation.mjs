/** route/error/source-order checks; built-ins only, no Docker or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareExportFilters, isFreightListUrl } from '../../apps/rxo-integration/src/lib/rxo-filter-readiness.mjs';
let passed=0;
async function test(name,body){await body();passed++;console.log('[PASS] '+name);}
const base='https://customer.rxoconnect.rxo.com',origin=base+'/orders/list',empty={count:async()=>0};
function fakePage(url,flags={}){
 const f={url:()=>url,getByRole:()=>empty,getByText:()=>empty,getByLabel:()=>empty,getByPlaceholder:()=>empty,
  locator:s=>s==='body'?{evaluate:async()=>({passwordVisible:false,otpVisible:false,mfaPrompt:false,accessDenied:false,accountSelection:false,filtersTextPresent:false,visibleComboboxes:0,...flags})}:{...empty,filter:()=>empty}};
 return {url:()=>url,frames:()=>[f],waitForTimeout:async()=>{throw Error('Unexpected wait in zero-time policy test');}};
}
for(const p of ['/orders/list','/active-shipments','/shipment-freight'])await test('Known freight route '+p,()=>assert(isFreightListUrl(base+p,base+p)));
await test('Query does not change route identity',()=>assert(isFreightListUrl(origin+'?view=x',origin)));
for(const p of [base+'/reset-password',base+'/accounts','https://other.invalid/orders/list','http://customer.rxoconnect.rxo.com/orders/list','not a url'])await test('Refuse foreign/unknown route '+p,()=>assert(!isFreightListUrl(p,origin)));
await test('Wrong expected list route refused',()=>assert(!isFreightListUrl(origin,base+'/shipment-freight')));
await test('Invalid timeout refused before browser access',async()=>{
 await assert.rejects(prepareExportFilters({},origin,{timeoutMs:-1}),/Invalid filter preparation timeout/);
 await assert.rejects(prepareExportFilters({},origin,{stableMs:NaN}),/Invalid filter preparation timeout/);
});
await test('Missing controls return specific diagnostic and no Reset clicks',async()=>{
 let d;await assert.rejects(prepareExportFilters(fakePage(origin),origin,{timeoutMs:0,onDiagnostic:x=>d=x}),/FILTER_PREPARATION_NOT_AVAILABLE/);
 assert.equal(d.preparation.resetClicks,0);assert.equal(d.preparation.directions.Origin.neutral,false);
});
for(const [flag,code] of [['passwordVisible','AUTH_ACTION_REQUIRED'],['accountSelection','ACCOUNT_SELECTION_REQUIRED'],['accessDenied','ACCESS_DENIED']])await test('Pre-reset '+code+' short circuit',async()=>{
 let d;await assert.rejects(prepareExportFilters(fakePage(origin,{[flag]:true}),origin,{timeoutMs:0,onDiagnostic:x=>d=x}),new RegExp(code));assert.equal(d.preparation.resetClicks,0);
});
const source=fs.readFileSync('apps/rxo-integration/src/lib/rxo-export-dataset.mjs','utf8');
const downloadSource=fs.readFileSync('apps/rxo-integration/src/lib/rxo-export-download.mjs','utf8');
const panelSource=fs.readFileSync('apps/rxo-integration/src/lib/rxo-filter-panel.mjs','utf8');
const filterUiSource=fs.readFileSync('apps/rxo-integration/src/lib/rxo-filter-ui.mjs','utf8');
const ready=panelSource.slice(panelSource.indexOf('async function pageReadyForFilters('),panelSource.indexOf('async function filterPanelInScope'));
const load=filterUiSource.slice(filterUiSource.indexOf('async function loadPageForFilterTest('));
const direction=source.slice(source.indexOf('async function exportOneDirection('));
await test('Production prepares before label lookup',()=>assert(ready.indexOf('await prepareExportFilters(')<ready.indexOf('await waitForNamedFilter(')));
await test('Production forwards requested direction and URL',()=>assert(/pageReadyForFilters\(\s*page,\s*label,\s*pageCase.url/.test(load)));
await test('Production still applies verified filter before download',()=>{
 assert(direction.indexOf('await loadPageForFilterTest(')<direction.indexOf('await applyFortWayneFilter('));
 assert(direction.indexOf('await applyFortWayneFilter(')<direction.indexOf('await exportDownloadVerified('));
 const verifiedDownload=downloadSource.slice(downloadSource.indexOf('async function exportDownloadVerified('),downloadSource.indexOf('async function findExportControl('));
 assert(verifiedDownload.includes('await clickExportAndSave(options)'));
});
await test('Navigation failure retains specific last failure',()=>assert(load.includes('Last failure: ${lastError}')));
await test('Collector fingerprints both runtime modules',()=>{
 const c=fs.readFileSync('tools/truck-log/new-host/collect-diagnostics.mjs','utf8');assert(c.includes('filterReadinessSha256'));assert(c.includes('/app/src/lib/rxo-filter-readiness.mjs'));
});
console.log(`[PASS] filter preparation: ${passed} local source/policy cases. Browser behavior is tested separately.`);
