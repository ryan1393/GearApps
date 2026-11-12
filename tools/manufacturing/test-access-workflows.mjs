import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright';

if (process.env.MESHFORGE_ALLOW_TEST_ACCOUNTS !== 'YES' || !/(test|cloud_dev)/i.test(process.env.DATABASE_NAME ?? '')) throw new Error('Use an explicitly authorized disposable test database (MESHFORGE_ALLOW_TEST_ACCOUNTS=YES).');
const api = 'http://127.0.0.1:3333/api/v1';
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
async function call(path, method='GET', body, token, expected=200) {
  const response=await fetch(api+'/'+path,{method,headers:{'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  assert.equal(response.status,expected,method+' '+path+': '+(data.message??response.status));
  checks++;return data;
}

async function makeShelf(shelfLetter, token, description) {
  for (let layer=9;layer>=1;layer--) for (const bin of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const serial=`CGRR-${shelfLetter}${layer}${bin}`;
    const probe=await fetch(api+'/locations/scan/'+serial,{headers:{Authorization:'Bearer '+token}});
    if (probe.ok) continue;
    assert.equal(probe.status,404,'Shelf availability lookup');
    return call('locations','POST',{serial_number:serial,number:shelfLetter+layer+bin,description,department:'CUTTERGRIND',location_type:'SHELF',enabled:true},token,201);
  }
  throw new Error('Test shelf grid is full; use a fresh disposable database.');
}

const admin=(await call('auth/email/login','POST',{email:'admin@example.com',password:process.env.SEED_ADMIN_PASSWORD})).accessToken;
await call('admin/access/roles','GET',undefined,undefined,401);
const catalog=await call('admin/access/catalog','GET',undefined,admin);
check(catalog.some(row=>row.key==='trays:getDashboard'),'Dashboard action appears in catalog');
check(!catalog.some(row=>row.key==='admin/access:create'),'Administrator actions cannot be delegated');
const departments=await call('admin/master-data/departments','GET',undefined,admin);
const department=departments.find(row=>row.code==='45');check(department,'Cutter Grind department present');
const suffix=crypto.randomBytes(6).toString('hex');
const password='Aa1!'+crypto.randomBytes(24).toString('hex');
const account=await call('users','POST',{email:`cloud-${suffix}@example.com`,password,firstName:'Cloud',lastName:'Test',role:'user',departmentId:department.id},admin,201);
const role=await call('admin/access/roles','POST',{name:'Cloud test '+suffix,permissions:['trays:getDashboard'],enabled:true},admin,201);
let badgeToken;
const uid='CLOUDTEST'+suffix.toUpperCase(), replacement=uid+'NEW';
let browser;
try {
  await call(`admin/access/badges/${account.id}/assign`,'POST',{uid},admin,201);
  const otherUser=(await call('users?perPage=100','GET',undefined,admin)).data.find(user=>user.email==='user@example.com');
  check(otherUser,'A second test account is available');
  await call(`admin/access/badges/${otherUser.id}/assign`,'POST',{uid},admin,409);
  badgeToken=(await call('auth/badge/login','POST',{uid})).accessToken;
  await call('admin/access/roles','GET',undefined,badgeToken,403);
  await call(`admin/access/users/${account.id}/role`,'PUT',{role_id:role.id},admin);
  await call('auth/me','GET',undefined,badgeToken,401);
  badgeToken=(await call('auth/badge/login','POST',{uid})).accessToken;
  await call('trays/dashboard','GET',undefined,badgeToken);
  await call('locations','GET',undefined,badgeToken,403);
  await call(`admin/access/roles/${role.id}`,'PATCH',{name:role.name,permissions:role.permissions,enabled:false},admin);
  await call('auth/me','GET',undefined,badgeToken,401);
  badgeToken=(await call('auth/badge/login','POST',{uid})).accessToken;
  await call('trays/dashboard','GET',undefined,badgeToken,403);
  await call(`admin/access/users/${account.id}/role`,'PUT',{role_id:null},admin);
  await call(`admin/access/badges/${account.id}/assign`,'POST',{uid:replacement},admin,201);
  const revoked=await call('auth/badge/login','POST',{uid},undefined,401);check(revoked.message.includes('revoked'),'Revoked badge is explained');
  const unknown=await call('auth/badge/login','POST',{uid:'UNKNOWN'+suffix},undefined,401);check(unknown.message.includes('not recognized'),'Unknown badge is explained');
  await call(`users/${account.id}`,'PATCH',{active:false},admin);
  const inactive=await call('auth/badge/login','POST',{uid:replacement},undefined,401);check(inactive.message.includes('inactive'),'Inactive badge is explained');
  await call(`users/${account.id}`,'PATCH',{active:true},admin);

  const requirements=await call('cutter-config/blade-requirements','GET',undefined,admin);
  const requirement=requirements.find(row=>row.enabled && row.part_type?.code==='RING' && row.summary?.enabled);
  check(requirement,'A ring blade requirement is available');
  const shelf=await makeShelf('Z',admin,'Cloud workflow test '+suffix);
  const trays=[];
  for(let index=0;index<3;index++) trays.push(await call('trays','POST',{serial_number:'T'+Date.now()+index,enabled:true},admin,201));
  const payload=tray=>({tray_serial_number:tray.serial_number,summary_id:requirement.summary_id,part_type_id:requirement.part_type_id,stage:'READY_FOR_COATING',shelf_serial_number:shelf.serial_number,service_cycle:0});
  const preview=await call('bladeTrays/opening-inventory/preview','POST',payload(trays[0]),admin,201);
  check(preview.blade_count===requirement.required_blade_count,'Preview uses configured blade quantity');
  const before=await call('trays/'+trays[0].id,'GET',undefined,admin);check(before.blade_count===0,'Preview writes no stock');
  await call('bladeTrays/opening-inventory','POST',payload(trays[0]),admin,201);
  await call('bladeTrays/opening-inventory','POST',payload(trays[0]),admin,409);
  const invalid=await call('bladeTrays/opening-inventory/preview','POST',{...payload(trays[1]),stage:'INVALID'},admin,422);
  check(invalid.statusCode===422,'Invalid stages are rejected');

  if (process.argv.includes('--browser')) {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1920,height:1080}});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:4200/login');
    await page.getByLabel('Email address').fill('admin@example.com');
    await page.getByLabel('Password',{exact:true}).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.waitForURL('**/blades');
    const icon=page.locator('[danaOperationCard][icon="ship"] .dana-glyph-ship');
    await icon.waitFor();
    const mask=await icon.evaluate(el=>getComputedStyle(el).maskImage);
    check(mask.includes('.svg'),'Truck icon has an SVG mask');
    const iconResponse=await page.request.get(mask.slice(5,-2));check(iconResponse.ok() && (await iconResponse.text()).includes('<svg'),'Truck icon asset loads');
    await page.goto('http://127.0.0.1:4200/admin?tab=access');
    await page.getByRole('heading',{name:'Roles and permissions',exact:true}).waitFor();
    await page.getByRole('cell',{name:'Trays',exact:true}).first().waitFor();
    await page.getByLabel('Name',{exact:true}).fill('Browser role '+suffix);
    await page.getByLabel('Filter screens / actions',{exact:true}).fill('trays get Dashboard');
    await page.getByRole('checkbox',{name:'Allow trays get Dashboard',exact:true}).check();
    await page.getByRole('button',{name:'Save role (1 actions)',exact:true}).click();
    await page.getByText('Role saved. Affected accounts must sign in again.',{exact:true}).waitFor();checks++;
    const browserRole=(await call('admin/access/roles','GET',undefined,admin)).find(row=>row.name==='Browser role '+suffix);
    check(browserRole?.permissions.includes('trays:getDashboard'),'Role created through browser persists selected action');
    await call('admin/access/roles/'+browserRole.id,'PATCH',{name:browserRole.name,permissions:browserRole.permissions,enabled:false},admin);
    await page.getByLabel('Color theme').selectOption('dark');
    check(await page.locator('html').getAttribute('data-dana-theme')==='dark','Dark theme selected');
    await page.reload();await page.getByRole('heading',{name:'Roles and permissions',exact:true}).waitFor();
    check(await page.locator('html').getAttribute('data-dana-theme')==='dark','Theme survives reload');
    const help=page.getByLabel('How custom roles work');await help.focus();await page.keyboard.press('Enter');
    check(await help.evaluate(el=>el.parentElement.open),'Help works with keyboard');await page.keyboard.press('Escape');
    check(!(await help.evaluate(el=>el.parentElement.open)),'Help closes with Escape');
    fs.mkdirSync('/workspace/gearapps-cloud/screenshots',{recursive:true});
    await page.screenshot({path:'/workspace/gearapps-cloud/screenshots/roles-dark.png',fullPage:true});
    await page.setViewportSize({width:1366,height:768});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin layout fits 1366px width');
    await page.screenshot({path:'/workspace/gearapps-cloud/screenshots/roles-1366.png',fullPage:true});
    await page.setViewportSize({width:1920,height:1080});
    const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    const touchPage=await touch.newPage();await touchPage.goto('http://127.0.0.1:4200/login');
    await touchPage.evaluate(token=>localStorage.setItem('app-access-token',token),admin);
    await touchPage.goto('http://127.0.0.1:4200/admin?tab=access');
    const touchHelp=touchPage.getByLabel('How custom roles work');await touchHelp.tap();
    check(await touchHelp.evaluate(el=>el.parentElement.open),'Help opens on touch');
    const helpBounds=await touchPage.locator('.dana-help[open] .dana-help-content').boundingBox();
    check(helpBounds && helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= 390,'Touch help stays within the viewport');
    await touchHelp.tap();
    check(!(await touchHelp.evaluate(el=>el.parentElement.open)),'Help closes on touch');await touch.close();
    await page.goto('http://127.0.0.1:4200/admin?tab=launch');
    const editor=page.getByLabel('Or paste CSV');
    const header='tray,summary,part_type,stage,shelf,service_cycle';
    const summary=requirement.summary.number+(requirement.summary.revision?' rev '+requirement.summary.revision:'');
    const csv=tray=>`${tray.serial_number},${summary},RING,READY_FOR_COATING,${shelf.serial_number},0`;
    await editor.fill(header+'\n'+csv(trays[1])+'\n'+csv(trays[1]));
    await page.getByRole('button',{name:'Preview and validate'}).click();
    await page.getByText('Duplicate tray in this upload. Remove duplicate rows.',{exact:false}).first().waitFor();checks++;
    await editor.fill(header+'\n'+csv(trays[1])+'\n'+csv(trays[2]));
    await page.getByRole('button',{name:'Preview and validate'}).click();
    await page.getByText('2 trays validated. Review the table, then record them.').waitFor();checks++;
    // Simulate one conflict after preview, while the other row commits through the live API.
    await page.route('**/api/v1/bladeTrays/opening-inventory',async route=>{
      if(route.request().postDataJSON()?.tray_serial_number===trays[2].serial_number) return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Simulated concurrent tray change'})});
      return route.continue();
    });
    await page.getByRole('button',{name:'Record 2 reviewed trays'}).click();
    await page.getByText('1 saved; 1 failed.',{exact:true}).waitFor();checks++;
    const saved=await call('trays/'+trays[1].id,'GET',undefined,admin);check(saved.blade_count===requirement.required_blade_count,'Successful bulk row committed');
    const unsaved=await call('trays/'+trays[2].id,'GET',undefined,admin);check(unsaved.blade_count===0,'Failed bulk row left untouched');
    await page.goto('http://127.0.0.1:4200/admin?tab=locations');
    await page.getByText('Mass edit location descriptions',{exact:true}).click();
    await page.getByLabel('Filter locations',{exact:true}).fill(shelf.serial_number);
    await page.getByLabel('Description for '+shelf.serial_number,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Select filtered',exact:true}).click();
    await page.getByLabel('Description for '+shelf.serial_number,{exact:true}).fill('Reviewed cloud test description');
    await page.getByRole('button',{name:'Save 1 selected changes',exact:true}).click();
    await page.getByText('1 saved; 0 failed. Failed changes remain selected for review.',{exact:true}).waitFor();checks++;
    const otherShelf=await makeShelf('Y',admin,'Cloud partial '+suffix);
    await call('locations/'+shelf.id,'PATCH',{description:'Cloud partial '+suffix},admin);
    await page.reload();await page.getByText('Mass edit location descriptions',{exact:true}).click();
    await page.getByLabel('Filter locations',{exact:true}).fill('Cloud partial '+suffix);
    await page.getByLabel('Description for '+shelf.serial_number,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Select filtered',exact:true}).click();
    await page.getByLabel('Description for '+shelf.serial_number,{exact:true}).fill('Saved partial row');
    await page.getByLabel('Description for '+otherShelf.serial_number,{exact:true}).fill('Failed partial row');
    await page.route('**/api/v1/locations/'+otherShelf.id,route=>route.request().method()==='PATCH'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Simulated edit conflict'})}):route.continue());
    await page.getByRole('button',{name:'Save 2 selected changes',exact:true}).click();
    await page.getByText('1 saved; 1 failed. Failed changes remain selected for review.',{exact:true}).waitFor();checks++;
    const current=await call('locations/'+otherShelf.id,'GET',undefined,admin);check(current.description==='Cloud partial '+suffix,'Failed edit preserves existing description');
    await page.getByRole('button',{name:'Cancel unsaved changes',exact:true}).click();
    check(await page.getByLabel('Description for '+otherShelf.serial_number,{exact:true}).inputValue()==='Cloud partial '+suffix,'Cancel restores unsaved edit');
    for (let port=4200;port<=4203;port++) {
      await page.goto(`http://127.0.0.1:${port}/login`);
      await page.getByLabel('Color theme').selectOption('dark');
      check(await page.getByLabel('Email address').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(32, 42, 55)','Dark input surface on '+port);
      await page.getByLabel('Color theme').selectOption('light');
      check(await page.locator('html').getAttribute('data-dana-theme')==='light','Light theme on '+port);
      await page.setViewportSize({width:390,height:844});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile login fits width on '+port);
      await page.setViewportSize({width:1920,height:1080});
    }
    await call(`admin/access/roles/${role.id}`,'PATCH',{name:role.name,permissions:catalog.filter(row=>row.method==='GET').map(row=>row.key),enabled:true},admin);
    await call(`admin/access/users/${account.id}/role`,'PUT',{role_id:role.id},admin);
    await page.goto('http://127.0.0.1:4200/login');await page.getByLabel('Or scan your badge').fill(replacement);await page.getByLabel('Or scan your badge').press('Enter');
    await page.waitForURL('**/blades');checks++;
    check(await page.getByRole('link',{name:'Operations Station',exact:true}).count()===0,'Read-only role hides operation navigation');
    check(errors.length===0,'No browser runtime errors: '+errors.join('; '));
    await context.close();
  }
  await call(`admin/access/badges/${account.id}/revoke`,'POST',{},admin,201);
  await call('auth/badge/login','POST',{uid:replacement},undefined,401);
  await call('auth/email/login','POST',{email:account.email,password});
  console.log(`PASS: ${checks} access, inventory${browser?', and Chromium browser':''} checks. Badge input is simulated; physical reader hardware is unverified.`);
} finally {
  await browser?.close();
  await call(`admin/access/badges/${account.id}/revoke`,'POST',{},admin,201).catch(()=>{});
  await call(`users/${account.id}`,'PATCH',{active:false},admin).catch(()=>{});
  await call(`admin/access/roles/${role.id}`,'PATCH',{name:role.name,permissions:role.permissions,enabled:false},admin).catch(()=>{});
}
