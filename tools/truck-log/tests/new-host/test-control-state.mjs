/** decision-function tests. DOM objects here are explicit stand-ins, not a browser.
 * The worker's image-build suite separately tests the same function in Chromium.
 */
import assert from 'node:assert/strict';
import { readDirectionControlState } from '../../../../apps/rxo-integration/src/lib/rxo-filter-readiness.mjs';
const oldStyle=globalThis.getComputedStyle;
globalThis.getComputedStyle=node=>({display:'inline-block',visibility:'visible',...node.style});
let passed=0;
function test(name,body){body();passed++;console.log('[PASS] '+name);}
function control({tag='MAT-SELECT',classes=[],text='',attributes={},slot=false,placeholder=false,chip=false,selectedOptions=[],value='',shown=true}={}){
 const e={tagName:tag,classList:{contains:c=>classes.includes(c)},style:{},value,selectedOptions,
  getClientRects:()=>shown?[{}]:[],getAttribute:name=>attributes[name]??null,matches:()=>true,closest:()=>null,
  querySelector:selector=>selector.includes('value-text')?(slot?{}:null):selector.includes('placeholder')?(placeholder?{closest:()=>null,style:{}}:null):null,
  querySelectorAll:selector=>selector.includes('mat-chip')&&chip?[{getClientRects:()=>[{}],style:{}}]:[],
  cloneNode:()=>{const make=()=>({textContent:text,querySelectorAll:()=>[],cloneNode:make});return make();}};e.parentElement=e;return e;
}
try{
 test('Classic empty state is independent of label text',()=>assert.equal(readDirectionControlState(control({classes:['mat-select-empty']}),'Origin').reason,'MATERIAL_EMPTY_CLASS'));
 test('MDC empty state is independent of label text',()=>assert.equal(readDirectionControlState(control({classes:['mat-mdc-select-empty']}),'Destination').neutral,true));
 test('Explicit placeholder branch supplies empty proof',()=>assert.equal(readDirectionControlState(control({placeholder:true}),'Origin').reason,'MATERIAL_PLACEHOLDER_BRANCH'));
 test('Selected branch overrides empty class',()=>assert.equal(readDirectionControlState(control({classes:['mat-select-empty'],slot:true}),'Origin').neutral,false));
 test('Selected literal label is not a placeholder',()=>assert.equal(readDirectionControlState(control({slot:true,text:'Origin'}),'Origin').neutral,false));
 test('Unknown blank combobox remains blocked',()=>assert.equal(readDirectionControlState(control({tag:'BUTTON'}),'Origin').neutral,false));
 test('Existing strict text placeholder preserved',()=>assert.equal(readDirectionControlState(control({tag:'BUTTON',text:'Origin'}),'Origin').reason,'LEGACY_EXACT_PLACEHOLDER'));
 test('A different direction is not a placeholder match',()=>assert.equal(readDirectionControlState(control({tag:'BUTTON',text:'Destination'}),'Origin').neutral,false));
 test('Selected text prefix remains blocked',()=>assert.equal(readDirectionControlState(control({tag:'BUTTON',text:'Origin fixture customer'}),'Origin').neutral,false));
 test('Input value blocks empty proof',()=>assert.equal(readDirectionControlState(control({tag:'INPUT',value:'fixture'}),'Origin').neutral,false));
 test('Input chip blocks even with empty text input',()=>assert.equal(readDirectionControlState(control({tag:'INPUT',chip:true}),'Origin').neutral,false));
 test('Native empty select remains clear',()=>assert.equal(readDirectionControlState(control({tag:'SELECT',selectedOptions:[{value:''}]}),'Origin').neutral,true));
 test('Native multiple select checks every selected value',()=>assert.equal(readDirectionControlState(control({tag:'SELECT',selectedOptions:[{value:''},{value:'fixture'}]}),'Origin').neutral,false));
 test('Disabled control cannot prove ready',()=>assert.equal(readDirectionControlState(control({attributes:{'aria-disabled':'true'}}),'Origin').reason,'CONTROL_DISABLED'));
 test('Open dropdown cannot prove a closed cleared control',()=>assert.equal(readDirectionControlState(control({attributes:{'aria-expanded':'true'}}),'Origin').reason,'CONTROL_EXPANDED'));
 test('Hidden control is refused',()=>assert.equal(readDirectionControlState(control({shown:false}),'Origin').reason,'CONTROL_HIDDEN'));
 test('Returned evidence omits values and location labels',()=>{const result=readDirectionControlState(control({text:'PRIVATE-fixture-location',slot:true}),'Origin');assert(!JSON.stringify(result).includes('PRIVATE-fixture'));assert.deepEqual(Object.keys(result).sort(),['kind','neutral','reason','signals']);});
 console.log(`[PASS] control-state decision tests: ${passed}; DOM stand-ins, no Docker/RXO access.`);
}finally{if(oldStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=oldStyle;}
