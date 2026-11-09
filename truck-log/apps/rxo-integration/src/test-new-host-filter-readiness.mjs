import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { waitForNamedFilter, filterContext, safePageUrl, collectLabeledControls, prepareExportFilters, readDirectionControlState } from './lib/rxo-filter-readiness.mjs';
import { openFilter, filterPanelLocator, pageReadyForFilters, loadPageForFilterTest, collectFilterCandidates } from './rxo-fort-wayne-export.mjs';

const browser = await chromium.launch({ headless: true, executablePath: process.env.RXO_TEST_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
let checks = 0;
async function test(name, body) {
  const page = await browser.newPage();
  try { await body(page); checks++; console.log(`[PASS] ${name}`); }
  finally { await page.close(); }
}
const html = `<label for="origin">Origin</label><select id="origin" aria-label="Origin"><option>Choose</option></select>`;
try {
  await test('Unrelated status control is NOT Origin readiness', async page => {
    await page.setContent('<select aria-label="Status"><option>All</option></select>');
    await assert.rejects(waitForNamedFilter(page, 'Origin', { timeoutMs: 100, allowReveal: false }), /FILTER_NOT_AVAILABLE/);
  });
  await test('Delayed Origin after unrelated Angular shell is awaited', async page => {
    await page.setContent(`<select aria-label="Status"></select><script>setTimeout(()=>document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}), 700)</script>`);
    const now=Date.now();const result=await waitForNamedFilter(page,'Origin',{timeoutMs:3000});
    assert(result.length); assert(Date.now()-now>450);
  });
  await test('Fresh collapsed Filters panel is explicitly expanded', async page => {
    await page.setContent(`<button aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#filters').hidden=false">Filters</button><div id="filters" hidden>${html}</div>`);
    assert((await waitForNamedFilter(page,'Origin',{timeoutMs:1500})).length);
  });
  await test('Already expanded Filters is not collapsed', async page => {
    await page.setContent(`<button aria-expanded="true" onclick="document.body.dataset.clicked='bad'">Filters</button>${html}`);
    await waitForNamedFilter(page,'Origin',{timeoutMs:100});
    assert.equal(await page.locator('body').getAttribute('data-clicked'),null);
  });
  await test('Ambiguous Filters buttons are never guessed', async page => {
    await page.setContent(`<button onclick="document.body.dataset.clicked='bad'">Filters</button><button>Filters</button>`);
    await assert.rejects(waitForNamedFilter(page,'Origin',{timeoutMs:100}));
    assert.equal(await page.locator('body').getAttribute('data-clicked'),null);
  });
  await test('Origin is never substituted for Destination', async page => {
    await page.setContent(html);await assert.rejects(waitForNamedFilter(page,'Destination',{timeoutMs:100}),/Destination/);
  });
  await test('Control inside frame is detected', async page => {
    await page.setContent(`<iframe srcdoc='${html.replaceAll("'",'&#39;')}'></iframe>`);
    assert((await waitForNamedFilter(page,'Origin',{timeoutMs:1500})).length);
  });
  await test('MFA/login is classified without recording input values', async page => {
    await page.setContent('<input type="password" value="fixture-secret"><p>Verify your identity</p>');
    let diagnostic;await assert.rejects(waitForNamedFilter(page,'Origin',{timeoutMs:100,onDiagnostic:d=>{diagnostic=d;}}),/AUTH_ACTION_REQUIRED/);
    assert(!JSON.stringify(diagnostic).includes('fixture-secret'));
  });
  await test('Account selection is not declared an export success', async page => {
    await page.setContent('<p>Select your customer</p><select aria-label="Account"></select>');
    assert.equal((await filterContext(page)).classification,'ACCOUNT_SELECTION_REQUIRED');
  });
  await test('Access denied is diagnosed separately', async page => {
    await page.setContent('<p>Access denied</p>');assert.equal((await filterContext(page)).classification,'ACCESS_DENIED');
  });
  await test('Login tokens and query data are removed from diagnostic URLs', async () => {
    assert.equal(safePageUrl('https://user:secret@example.test/orders?token=secret#private'),'https://example.test/orders');
  });
  await test('Hidden controls do not count as ready', async page => {
    await page.setContent(`<div hidden>${html}</div>`);assert.equal((await collectLabeledControls(page,'Origin')).length,0);
  });
  await test('Search field inside an open listbox is not mistaken for trigger', async page => {
    await page.setContent('<div role="listbox"><input placeholder="Origin"></div>');assert.equal((await collectLabeledControls(page,'Origin')).length,0);
  });
  await test('Production openFilter waits for real Material panel after click', async page => {
    await page.setContent(`<button role="combobox" aria-label="Origin" onclick="document.querySelector('#panel').hidden=false">Origin</button><div id="panel" class="mat-select-panel" role="listbox" hidden><div role="option">12808</div></div>`);
    const diagnostic={};const panel=await openFilter(page,'Origin',diagnostic);assert(panel);assert(diagnostic.openedWith);
  });
  await test('Production Material panel discovery supports frames', async page => {
    await page.setContent(`<iframe srcdoc='<div class="mat-select-panel" role="listbox"><div role="option">12808</div></div>'></iframe>`);
    await page.waitForTimeout(200);assert(await filterPanelLocator(page));
  });
  // Readiness fixtures. Navigation/URLs/saved defaults are simulated with setContent;
  // selectors, DOM reads and clicks run in real Chromium. No RXO access.
  const listUrl='https://customer.rxoconnect.rxo.com/orders/list';
  function savedViewFixture({inert=false,labels=false,duplicate=false,delayed=0,resetTag='button',otherReset=false}={}) {
    const label=name=>labels?`aria-label="${name}"`:'';
    const reset=`<${resetTag} class="list-reset" onclick="resetLocations()"><span>Reset</span></${resetTag}>`;
    return `<h1>Orders</h1><section id="toolbar"><input placeholder="Search">
      <button role="combobox" id="o" ${label('Origin')}>Selected plant</button>
      <button role="combobox" id="d" ${label('Destination')}>Selected customer +1</button>
      <button role="combobox">Anytime</button><button>Filters</button>${reset}${duplicate?reset:''}
      <span>Sort by</span><button role="combobox">Sort choice</button><button>Save view</button></section>
      <button id="export" onclick="window.exportClicks++">Export</button>
      ${otherReset?'<form><button onclick="window.formReset++">Reset</button></form>':''}
      <script>window.resetClicks=0;window.exportClicks=0;window.formReset=0;
      function resetLocations(){window.resetClicks++;${inert?'':`setTimeout(()=>{document.querySelector('#o').textContent='Origin';document.querySelector('#d').textContent='Destination';},${delayed})`}}
      </script>`;
  }
  async function freightPage(page,fixture,url=listUrl) {
    let logicalUrl=url;
    const frameView=f=>new Proxy(f,{get(t,k){if(k==='url')return ()=>f===page.mainFrame()?logicalUrl:t.url();const v=t[k];return typeof v==='function'?v.bind(t):v;}});
    const view=new Proxy(page,{get(t,k){
      if(k==='url')return ()=>logicalUrl;
      if(k==='frames')return ()=>t.frames().map(frameView);
      // Shorten cosmetic exporter sleeps, not readiness predicates or clicks.
      if(k==='waitForTimeout')return ms=>t.waitForTimeout(Math.min(ms,20));
      if(k==='goto')return async destination=>{logicalUrl=destination;return t.setContent(destination==='about:blank'?'':fixture);};
      if(k==='reload')return ()=>t.setContent(fixture);
      const v=t[k];return typeof v==='function'?v.bind(t):v;
    }});
    await view.goto(url);return view;
  }
  // Keep the same readiness/stability predicates while allowing slower CI
  // Chromium IPC. Negative cases still supply their explicit short deadline.
  const prepare=(page,options={})=>prepareExportFilters(page,listUrl,{timeoutMs:6000,stableMs:150,legacyCollect:collectFilterCandidates,...options});
  await test('reproduces label-only failure before verified Reset',async page=>{
    page=await freightPage(page,savedViewFixture());
    await assert.rejects(waitForNamedFilter(page,'Origin',{timeoutMs:100,allowReveal:false}),/FILTER_NOT_AVAILABLE/);
    assert.equal(await page.evaluate(()=>window.resetClicks),0);
    assert.equal((await prepare(page)).method,'TOOLBAR_RESET_VERIFIED');
    assert.equal(await page.evaluate(()=>window.resetClicks),1);assert.equal(await page.evaluate(()=>window.exportClicks),0);
  });
  await test('navigation reapplies selected defaults and is prepared again',async page=>{
    page=await freightPage(page,savedViewFixture());await prepare(page);await page.goto(listUrl);
    assert.equal((await collectLabeledControls(page,'Origin')).length,0);await prepare(page);assert.equal(await page.evaluate(()=>window.resetClicks),1);
  });
  await test('nested span Reset works in the identified toolbar',async page=>{
    page=await freightPage(page,savedViewFixture({resetTag:'span'}));assert.equal((await prepare(page)).method,'TOOLBAR_RESET_VERIFIED');
  });
  await test('static aria labels do not falsely prove selected controls empty',async page=>{
    page=await freightPage(page,savedViewFixture({labels:true}));assert((await collectLabeledControls(page,'Origin')).length);assert.equal((await prepare(page)).resetClicks,1);
  });
  await test('ambiguous toolbar Reset is never guessed',async page=>{
    page=await freightPage(page,savedViewFixture({duplicate:true}));await assert.rejects(prepare(page),/FILTER_RESET_AMBIGUOUS/);assert.equal(await page.evaluate(()=>window.resetClicks),0);
  });
  await test('separate form Reset is not clicked',async page=>{
    page=await freightPage(page,savedViewFixture({otherReset:true}));await prepare(page);assert.equal(await page.evaluate(()=>window.formReset),0);assert.equal(await page.evaluate(()=>window.resetClicks),1);
  });
  await test('inert Reset never authorizes export or repeated Reset clicks',async page=>{
    page=await freightPage(page,savedViewFixture({inert:true,labels:true}));await assert.rejects(prepare(page,{timeoutMs:400}),/FILTER_RESET_UNVERIFIED/);
    assert.equal(await page.evaluate(()=>window.resetClicks),1);assert.equal(await page.evaluate(()=>window.exportClicks),0);
  });
  await test('waits for asynchronous reset completion',async page=>{
    page=await freightPage(page,savedViewFixture({delayed:400}));const start=Date.now();await prepare(page);assert(Date.now()-start>=500);
  });
  await test('already clear controls require no reset',async page=>{
    page=await freightPage(page,'<select aria-label="Origin"><option value="">Choose</option></select><select aria-label="Destination"><option value="">Choose</option></select>');assert.equal((await prepare(page)).method,'ALREADY_CLEAR');
  });
  await test('four unrelated dropdowns are not direction readiness',async page=>{
    page=await freightPage(page,'<button>Export</button>'+ '<select aria-label="Status"><option>All</option></select>'.repeat(4));await assert.rejects(prepare(page,{timeoutMs:200}),/FILTER_PREPARATION_NOT_AVAILABLE/);
  });
  await test('login/MFA blocks reset and diagnostics exclude values',async page=>{
    page=await freightPage(page,savedViewFixture()+'<input type="password" value="fixture-secret"><p>Verify your identity</p>');let d;
    await assert.rejects(prepare(page,{onDiagnostic:x=>d=x}),/AUTH_ACTION_REQUIRED/);assert.equal(await page.evaluate(()=>window.resetClicks),0);assert(!JSON.stringify(d).includes('fixture-secret'));assert(!JSON.stringify(d).includes('Selected customer'));
  });
  await test('account selection blocks reset',async page=>{
    page=await freightPage(page,savedViewFixture()+'<p>Select your customer</p>');await assert.rejects(prepare(page),/ACCOUNT_SELECTION_REQUIRED/);assert.equal(await page.evaluate(()=>window.resetClicks),0);
  });
  await test('access denied blocks reset',async page=>{
    page=await freightPage(page,savedViewFixture()+'<p>Access denied</p>');await assert.rejects(prepare(page),/ACCESS_DENIED/);assert.equal(await page.evaluate(()=>window.resetClicks),0);
  });
  await test('password-reset route is never mutated',async page=>{
    page=await freightPage(page,savedViewFixture(),'https://customer.rxoconnect.rxo.com/reset-password');await assert.rejects(prepare(page),/FILTER_PAGE_MISMATCH/);assert.equal(await page.evaluate(()=>window.resetClicks),0);
  });
  await test('foreign-origin toolbar is never clicked',async page=>{
    page=await freightPage(page,savedViewFixture(),'https://untrusted.invalid/orders/list');await assert.rejects(prepare(page),/FILTER_PAGE_MISMATCH/);assert.equal(await page.evaluate(()=>window.resetClicks),0);
  });
  await test('Reset within a dialog is not a list-toolbar reset',async page=>{
    page=await freightPage(page,'<div role="dialog">'+savedViewFixture()+'</div>');await assert.rejects(prepare(page,{timeoutMs:200}),/FILTER_PREPARATION_NOT_AVAILABLE/);assert.equal(await page.evaluate(()=>window.resetClicks),0);
  });
  await test('hidden Reset is not clicked',async page=>{
    page=await freightPage(page,savedViewFixture());await page.locator('.list-reset').evaluate(el=>el.hidden=true);await assert.rejects(prepare(page,{timeoutMs:200}),/FILTER_PREPARATION_NOT_AVAILABLE/);assert.equal(await page.evaluate(()=>window.resetClicks),0);
  });
  await test('plain text without controls is insufficient',async page=>{
    page=await freightPage(page,'<p>Origin</p><p>Destination</p><button>Export</button>');await assert.rejects(prepare(page,{timeoutMs:100}),/FILTER_PREPARATION_NOT_AVAILABLE/);
  });
  await test('partial reset clearing only Origin still blocks export',async page=>{
    page=await freightPage(page,savedViewFixture({labels:true}));await page.evaluate(()=>{window.resetLocations=()=>{window.resetClicks++;document.querySelector('#o').textContent='Origin';};});
    await assert.rejects(prepare(page,{timeoutMs:400}),/FILTER_RESET_UNVERIFIED/);assert.equal(await page.evaluate(()=>window.exportClicks),0);
  });
  await test('Material placeholders ignore decorative icon text',async page=>{
    page=await freightPage(page,'<mat-form-field><mat-select role="combobox"><span>Origin</span><mat-icon>location_on</mat-icon></mat-select></mat-form-field><mat-form-field><mat-select role="combobox"><span>Destination</span><span aria-hidden="true">arrow</span></mat-select></mat-form-field>');assert.equal((await prepare(page)).method,'ALREADY_CLEAR');
  });
  await test('conflicting duplicate direction controls fail closed',async page=>{
    page=await freightPage(page,'<button role="combobox" aria-label="Origin">Origin</button><button role="combobox" aria-label="Origin">Selected plant</button><button role="combobox" aria-label="Destination">Destination</button>');await assert.rejects(prepare(page,{timeoutMs:200}),/FILTER_PREPARATION_NOT_AVAILABLE/);
  });
  await test('production loader prepares six page/direction combinations',async page=>{
    page=await freightPage(page,savedViewFixture());
    for(const pathname of ['/orders/list','/active-shipments','/shipment-freight'])for(const label of ['Origin','Destination']){
      const d=await loadPageForFilterTest(page,{url:'https://customer.rxoconnect.rxo.com'+pathname,name:'Fixture'},label);
      assert.equal(d.length,1);assert.equal(d[0].ready,true);assert.equal(await page.evaluate(()=>window.resetClicks),1);assert.equal(await page.evaluate(()=>window.exportClicks),0);
      await page.locator(label==='Origin'?'#o':'#d').evaluate(el=>el.textContent='Selected plant');
    }
  });
  await test('production readiness honors Destination, not only Origin',async page=>{
    page=await freightPage(page,savedViewFixture());assert.equal(await pageReadyForFilters(page,'Destination',listUrl),true);assert((await collectFilterCandidates(page,'Destination')).length);
  });

  // Tests use actual Angular Material DOM branches, including a floating label
  // outside an empty select value. There is no dependency on Angular debug APIs.
  function materialField(name, {mdc=false, selected=false, selectedText='Fixture location', emptyClass=true,
    placeholder='', hiddenPlaceholder=false, custom=false, disabled=false, expanded=false}={}) {
    const prefix=mdc?'mat-mdc-select':'mat-select';
    const value=selected?`<span class="${prefix}-value-text">${custom?'<mat-select-trigger></mat-select-trigger>':selectedText}</span>`:
      `<span class="${prefix}-placeholder" ${hiddenPlaceholder?'hidden':''}>${placeholder}</span>`;
    return `<mat-form-field class="mat-form-field" style="display:inline-block"><label id="${name}-label">${name}</label>
      <mat-select id="${name}" class="${prefix}${emptyClass?' '+prefix+'-empty':''}" role="combobox" aria-labelledby="${name}-label"
        aria-expanded="${expanded}" aria-disabled="${disabled}" style="display:inline-block;min-width:140px;min-height:25px">
        <div class="${prefix}-trigger"><div class="${prefix}-value">${value}</div>
        <div class="${prefix}-arrow-wrapper"><svg width="12" height="12" aria-hidden="true"><path d="M0 0"/></svg></div></div>
      </mat-select></mat-form-field>`;
  }
  const readState=(page,name='Origin')=>page.locator('#'+name).evaluate(readDirectionControlState,name);
  for(const mdc of [false,true]) {
    await test(`${mdc?'MDC':'classic'} empty class with external label and blank value is clear`,async page=>{
      page=await freightPage(page,materialField('Origin',{mdc})+materialField('Destination',{mdc}));
      const state=await readState(page);assert.equal(state.reason,'MATERIAL_EMPTY_CLASS');assert(state.neutral);
      const ready=await prepare(page);assert.equal(ready.method,'ALREADY_CLEAR');assert.equal(ready.resetClicks,0);
    });
    await test(`${mdc?'MDC':'classic'} empty placeholder branch without empty class is clear`,async page=>{
      page=await freightPage(page,materialField('Origin',{mdc,emptyClass:false})+materialField('Destination',{mdc,emptyClass:false}));
      assert.equal((await readState(page)).reason,'MATERIAL_PLACEHOLDER_BRANCH');assert.equal((await prepare(page)).method,'ALREADY_CLEAR');
    });
    await test(`${mdc?'MDC':'classic'} selected-value slot labelled Origin is not empty`,async page=>{
      page=await freightPage(page,materialField('Origin',{mdc,selected:true,selectedText:'Origin',emptyClass:false})+materialField('Destination',{mdc}));
      const state=await readState(page);assert.equal(state.reason,'SELECTED_VALUE_PRESENT');assert.equal(state.neutral,false);
      await assert.rejects(prepare(page,{timeoutMs:100}),/FILTER_PREPARATION_NOT_AVAILABLE/);
    });
    await test(`${mdc?'MDC':'classic'} contradictory empty class plus selected slot fails closed`,async page=>{
      await page.setContent(materialField('Origin',{mdc,selected:true}));const state=await readState(page);
      assert.equal(state.neutral,false);assert(state.signals.materialEmpty);assert(state.signals.selectedValuePresent);
    });
    await test(`${mdc?'MDC':'classic'} reset to blank Material placeholder completes`,async page=>{
      const content=()=>materialField('Origin',{mdc,selected:true,emptyClass:false})+materialField('Destination',{mdc,selected:true,emptyClass:false});
      page=await freightPage(page,`<section>${content()}<button>Filters</button><button id="reset" onclick="resetFields()">Reset</button><span>Sort by</span><button>Save view</button></section><button id="export" onclick="window.exports++">Export</button>
        <script>window.resets=0;window.exports=0;function resetFields(){window.resets++;setTimeout(()=>{for(const e of document.querySelectorAll('mat-select')){e.classList.add('${mdc?'mat-mdc-select':'mat-select'}-empty');e.querySelector('.${mdc?'mat-mdc-select':'mat-select'}-value').innerHTML='<span class="${mdc?'mat-mdc-select':'mat-select'}-placeholder"></span>';}},150);}</script>`);
      const result=await prepare(page);assert.equal(result.method,'TOOLBAR_RESET_VERIFIED');assert.equal(result.resetClicks,1);
      assert.equal(await page.evaluate(()=>window.resets),1);assert.equal(await page.evaluate(()=>window.exports),0);
    });
  }
  await test('hidden stale placeholder is not empty proof',async page=>{
    await page.setContent(materialField('Origin',{emptyClass:false,hiddenPlaceholder:true}));const state=await readState(page);
    assert.equal(state.neutral,false);assert.equal(state.reason,'EMPTY_STATE_UNPROVED');
  });
  await test('blank custom selected trigger still blocks',async page=>{
    await page.setContent(materialField('Origin',{selected:true,custom:true,emptyClass:false}));assert.equal((await readState(page)).reason,'SELECTED_VALUE_PRESENT');
  });
  await test('aria-hidden placeholder text is not stripped as decorative',async page=>{
    page=await freightPage(page,'<button id="Origin" role="combobox" aria-label="Origin"><span aria-hidden="true">Origin</span></button><button role="combobox" aria-label="Destination">Destination</button>');
    assert.equal((await readState(page)).reason,'LEGACY_EXACT_PLACEHOLDER');assert.equal((await prepare(page)).method,'ALREADY_CLEAR');
  });
  await test('arbitrary aria-hidden selected text is not discarded',async page=>{
    await page.setContent('<button id="Origin" role="combobox" aria-label="Origin">Origin<span aria-hidden="true">Fixture location</span></button>');
    assert.equal((await readState(page)).neutral,false);
  });
  for(const flag of ['disabled','expanded'])await test(''+flag+' control blocks',async page=>{
    await page.setContent(materialField('Origin',{[flag]:true}));assert.equal((await readState(page)).reason,flag==='disabled'?'CONTROL_DISABLED':'CONTROL_EXPANDED');
  });
  await test('multiple native select with empty first and nonempty second blocks',async page=>{
    await page.setContent('<select id="Origin" aria-label="Origin" multiple><option value="" selected>Choose</option><option value="fixture" selected>Location</option></select>');
    assert.equal((await readState(page)).reason,'NATIVE_SELECTED');
  });
  await test('input with external selected chip blocks',async page=>{
    await page.setContent('<section><input id="Origin" role="combobox" aria-label="Origin"><mat-chip>Fixture location</mat-chip></section>');
    assert.equal((await readState(page)).reason,'INPUT_SELECTED');
  });
  await test('duplicate input controls in one label field are ambiguous',async page=>{
    await page.setContent('<mat-form-field id="field" style="display:block"><label>Origin</label><input role="combobox"><input role="combobox"></mat-form-field>');
    assert.equal((await page.locator('#field').evaluate(readDirectionControlState,'Origin')).reason,'AMBIGUOUS_CONTROL');
  });
  await test('empty generic combobox needs more than a static label',async page=>{
    await page.setContent('<button id="Origin" role="combobox" aria-label="Origin" style="min-width:40px;min-height:20px"></button>');
    assert.equal((await readState(page)).neutral,false);
  });
  await test('selected option or chip overrides an empty host',async page=>{
    await page.setContent(materialField('Origin'));await page.locator('#Origin').evaluate(e=>e.insertAdjacentHTML('beforeend','<span aria-selected="true">Fixture location</span>'));
    assert.equal((await readState(page)).reason,'SELECTED_VALUE_PRESENT');
  });
  await test('no-op reset yields explicit non-sensitive selected evidence',async page=>{
    page=await freightPage(page,`<section>${materialField('Origin',{selected:true,emptyClass:false})}${materialField('Destination',{selected:true,emptyClass:false})}<button>Filters</button><button onclick="window.resets++">Reset</button><span>Sort by</span><button>Save view</button></section><button onclick="window.exports++">Export</button><script>window.resets=0;window.exports=0;</script>`);
    let detail;const logs=[];await assert.rejects(prepare(page,{timeoutMs:350,log:t=>logs.push(t),onDiagnostic:d=>detail=d}),/FILTER_RESET_UNVERIFIED/);
    assert.equal(detail.preparation.version,18);assert.equal(detail.preparation.resetClicks,1);
    for(const label of ['Origin','Destination'])assert(detail.preparation.directions[label].checks.every(x=>x.reason==='SELECTED_VALUE_PRESENT'));
    assert(logs.some(line=>line.includes('SELECTED_VALUE_PRESENT')));assert(!JSON.stringify(detail).includes('Fixture location'));
    assert(!logs.join('\n').includes('Fixture location'));assert.equal(await page.evaluate(()=>window.exports),0);
  });
  await test('empty host with raw selected text still blocks',async page=>{
    await page.setContent(materialField('Origin'));await page.locator('#Origin').evaluate(el=>el.insertAdjacentHTML('beforeend','<span>Fixture customer</span>'));
    assert.equal((await readState(page)).reason,'CONFLICTING_VALUE_TEXT');
  });
  console.log(`[PASS] Browser fixture tests: ${checks}. These do NOT contact RXO or prove a live export.`);
} finally { await browser.close(); }
