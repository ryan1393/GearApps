// Real-browser fixtures exercise the production List helper without contacting RXO.
// npm --prefix apps/rxo-expedite ci; (cd apps/rxo-expedite && npx playwright install chromium)
// PLAYWRIGHT_CHROMIUM_EXECUTABLE may select a system Chromium instead.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openFreightList, assertFreightSession, freightViewCovered } from '../../../apps/rxo-expedite/src/lib/list-view.mjs';
const { chromium } = createRequire(new URL('../../../apps/rxo-expedite/package.json', import.meta.url))('playwright');
const browser = await chromium.launch({headless:true,
 ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
const context=await browser.newContext();
const url='https://www.expedite.rxo.com/WebClient/#/freight-on-the-move';
let html='',sequence=0;
await context.route('https://www.expedite.rxo.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
const page=await context.newPage();
async function fixture(value){html=value;await page.goto(url.replace('#', '?fixture='+(++sequence)+'#'));page.setDefaultTimeout(2000);}
try{
 await fixture(`<button onclick="window.clicked=(window.clicked||0)+1;document.getElementById('excel').hidden=false">List</button><button id="excel" hidden>Export to Excel</button>`);
 await openFreightList(page,{timeoutMs:1000});
 assert.equal(await page.evaluate(()=>window.clicked),1);
 await openFreightList(page,{timeoutMs:1000});
 assert.equal(await page.evaluate(()=>window.clicked),1);
 console.log('[PASS] real Chromium: one List click; no duplicate click for restored List');
 await fixture(`<input id="list" type="radio" name="view" style="position:absolute;opacity:0"><label for="list">List</label><button hidden id="excel">Export to Excel</button><script>document.getElementById('list').onchange=()=>document.getElementById('excel').hidden=false</script>`);
 await openFreightList(page,{timeoutMs:1000});
 assert.equal(await page.locator('#list').isChecked(),true);
 assert.equal(await page.getByText('Export to Excel',{exact:true}).isVisible(),true);
 console.log('[PASS] real Chromium: legacy radio label activates native List');
 await fixture(`<button>List</button><div style="position:fixed;inset:0;background:white">Loading freight</div>`);
 await assert.rejects(openFreightList(page,{timeoutMs:300}),e=>e.code==='FREIGHT_LIST_CONTROL_TIMEOUT');
 console.log('[PASS] real Chromium: does not force a click through loading overlay');
 await fixture(`<button>List</button><div role="dialog"><label>Password<input type="password"></label></div>`);
 await assert.rejects(openFreightList(page,{timeoutMs:300}),e=>e.code==='RXO_AUTH_SESSION_REVIEW');
 console.log('[PASS] real Chromium: expired-session overlay returns auth review');
 await fixture(`<button>List</button><button>List</button>`);
 await assert.rejects(openFreightList(page,{timeoutMs:300}),e=>e.code==='FREIGHT_LIST_CONTROL_REVIEW');
 console.log('[PASS] real Chromium: ambiguous controls fail closed');
 await fixture(`<button>List</button><div role="dialog"><label>Verification code<input autocomplete="one-time-code"></label></div>`);
 await assert.rejects(assertFreightSession(page),e=>e.code==='RXO_AUTH_VERIFICATION_REQUIRED');
 console.log('[PASS] real Chromium: verification overlay returns verification-required');
 const toggle='<div style="position:absolute;top:10px;right:10px"><button>List</button><button>Map</button></div><p>0 of 0 Shipments</p>';
 await fixture(toggle);
 assert.equal(await freightViewCovered(page),false);
 await fixture(toggle+'<div style="position:fixed;inset:0;background:rgba(0,0,0,.4)"><span>Loading</span></div>');
 assert.equal(await freightViewCovered(page),true);
 await fixture('<p>0 of 0 Shipments</p>');
 assert.equal(await freightViewCovered(page),true);
 await fixture('<div style="position:absolute;top:10px;right:10px"><label><span>List</span></label><a class="btn"><b>Map</b></a></div>');
 assert.equal(await freightViewCovered(page),false);
 console.log('[PASS] real Chromium: an empty list is believable only when nothing covers the List/Map switch');
}finally{await browser.close();}
