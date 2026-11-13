// Read-only route/layout audit. Uses local production builds and the existing test administrator.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const spacingReview=process.argv.includes('--spacing');
const output = path.join(root, spacingReview?'tmp/dana-spacing-review':'tmp/ui-ux-review');
const api = process.env.MESHFORGE_BASE_URL || 'http://127.0.0.1:3333/api/v1';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(api).hostname), 'Use a local review API');
const login = await fetch(api + '/auth/email/login', {
  method: 'POST', headers: {'content-type':'application/json'},
  body: JSON.stringify({email:process.env.MESHFORGE_ADMIN_EMAIL || 'admin@example.com',password:process.env.MESHFORGE_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD}),
});
assert.ok(login.ok, 'Review administrator login must succeed');
const {accessToken} = await login.json();
const apps = [
  {name:'blade-tracking',port:4200,routes:['/blades','/blades/tray-contents','/blades/body-shelves','/blades/inventory','/blades/all-inventory','/blades/locations','/blades/scrap-blades','/blades/cancel-last',...['intake','grinding','load-container','coater-shipments','receive-container','internal-movement'].map(op=>'/blades/operations?op='+op)]},
  {name:'cutter-builder',port:4201,routes:['/cutter-builder','/cutter-builder/requests','/cutter-builder/build','/cutter-builder/teardown','/cutter-builder/lookup','/cutter-builder/cancel-last']},
  {name:'greenshed',port:4202,routes:['/greenshed','/greenshed/cutter-requests','/greenshed/machines','/greenshed/setup','/greenshed/check','/greenshed/pull','/greenshed/lookup','/greenshed/cancel-last']},
  {name:'lapper-client',port:4203,routes:['/dashboard','/dashboard/cell/1','/lapping-summaries']},
  {name:'plant-dashboard',port:4204,routes:['/','/?view=reports']},
];
const adminTabs = ['users','access','part-summaries','parts','gearsets','roll-masters','models','machines','lapping-machines','dsf-mappings','label-printers','coater-rpa','launch','server-settings','trays','containers','locations','cutter-bodies','cycle-tests','scanners','macros','fanuc-variables','collector-tokens'];
apps[0].routes.push(...adminTabs.map(tab=>'/admin?tab='+tab),'/machine-counts');
apps[1].routes.push('/admin?tab=access');
apps[2].routes.push('/admin?tab=users');
apps[3].routes.push('/admin?tab=scanners');
await fs.mkdir(output,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const interactionRetry=process.argv.includes('--interactions-only');
const results = interactionRetry ? JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8')).results.filter(row=>row.width>=390) : [];
if(interactionRetry) assert.ok(results.length===180 && results.every(row=>row.passed),'Interaction retry requires the preceding successful route sweep');
const interactions = [];
const baseline = process.argv.includes('--baseline');
let interactionError;
try {
  if(!interactionRetry) {
  for (const viewport of [{width:1920,height:1080},{width:1024,height:768},{width:390,height:844}]) {
    for (const app of apps) {
      const context = await browser.newContext({viewport});
      await context.addInitScript(token=>localStorage.setItem('app-access-token',token),accessToken);
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const pageErrors = [], failedRequests = [];
      page.on('pageerror',error=>pageErrors.push(error.message));
      page.on('response',response=>{if(response.status()>=500) failedRequests.push({url:new URL(response.url()).pathname,status:response.status()});});
      const origin = `http://127.0.0.1:${app.port}`;
      for (const route of app.routes) {
        pageErrors.length=0; failedRequests.length=0;
        const record={app:app.name,width:viewport.width,route};
        try {
          await page.goto(origin+route,{waitUntil:'networkidle',timeout:20000});
          if (app.name==='plant-dashboard' && route.includes('view=reports')) await page.getByRole('tab',{name:'Reports',exact:true}).click();
          await page.locator('h1,h2,[role="alert"]').first().waitFor();
          Object.assign(record, await page.evaluate(spacing=>{
            const visible=element=>element.getClientRects().length>0 && getComputedStyle(element).visibility!=='hidden' && !element.closest('[inert],[aria-hidden="true"]');
            const label=element=>{
              const labelledBy=element.getAttribute('aria-labelledby');
              return element.getAttribute('aria-label') || (labelledBy ? labelledBy.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ') : '') ||
                Array.from(element.labels||[]).map(node=>node.textContent).join(' ') ||
                ((element.tagName==='BUTTON'||element.tagName==='A') ? element.textContent : '') || element.getAttribute('title') || '';
            };
            const controls=Array.from(document.querySelectorAll('input:not([type="hidden"]),select,textarea,button')).filter(visible);
            const unnamed=controls.filter(element=>!label(element).trim()).map(element=>({tag:element.tagName,name:element.getAttribute('name'),placeholder:element.getAttribute('placeholder'),type:element.getAttribute('type')}));
            const ids=new Map();
            for(const element of document.querySelectorAll('[id]')) ids.set(element.id,(ids.get(element.id)||0)+1);
            const page=document.querySelector('.gear-page,.dana-page');
            const pageStyle=page ? getComputedStyle(page) : null;
            const header=page?.querySelector(':scope > .dana-page-header,:scope > .gear-page-header');
            const padding=innerWidth<=767?16:26, panelPadding=innerWidth<=767?16:20;
            const spacingIssues=[];
            const workstation=page?.classList.contains('ops-station');
            if(spacing && pageStyle && !workstation && (parseFloat(pageStyle.paddingLeft)!==padding||parseFloat(pageStyle.paddingRight)!==padding))
              spacingIssues.push(`Page gutters ${pageStyle.paddingLeft}/${pageStyle.paddingRight}; expected ${padding}px`);
            const stacked=page?.matches('.dana-page-stack,.gear-workflow-page');
            if(spacing&&stacked&&header&&parseFloat(getComputedStyle(header).marginBottom)!==0)
              spacingIssues.push('Stacked page header adds a second bottom margin');
            const panels=Array.from(document.querySelectorAll('.dana-panel-padded,.dana-panel-body,.gear-workflow-section-body,.gear-admin-form')).filter(visible);
            const panelHeaders=Array.from(document.querySelectorAll('.dana-panel-header,[danaPanelHeader],.gear-panel-header')).filter(visible);
            if(spacing) for(const panel of panels){
              const style=getComputedStyle(panel);
              if(panel.classList.contains('is-flush'))continue;
              if(parseFloat(style.paddingLeft)!==panelPadding||parseFloat(style.paddingRight)!==panelPadding)
                spacingIssues.push(`${panel.className}: padding ${style.paddingLeft}/${style.paddingRight}; expected ${panelPadding}px`);
            }
            if(spacing) for(const panelHeader of panelHeaders){
              const style=getComputedStyle(panelHeader);
              if(parseFloat(style.paddingLeft)!==panelPadding||parseFloat(style.paddingRight)!==panelPadding)
                spacingIssues.push(`${panelHeader.className}: header gutters ${style.paddingLeft}/${style.paddingRight}; expected ${panelPadding}px`);
            }
            return {
              title:document.title,heading:document.querySelector('h1')?.textContent?.trim()||document.querySelector('h2')?.textContent?.trim(),
              bodyOverflow:document.documentElement.scrollWidth>innerWidth+2,
              mainCount:document.querySelectorAll('main:not([role]),[role="main"]').length,
              unnamedControls:unnamed,duplicateIds:[...ids].filter(([,count])=>count>1).map(([id])=>id),
              alerts:Array.from(document.querySelectorAll('[role="alert"]')).filter(visible).map(element=>element.textContent.trim()).filter(Boolean),
              spacing:spacing?{pagePadding:pageStyle?.padding,profile:workstation?'workstation':'standard',panels:panels.length,headers:panelHeaders.length,issues:spacingIssues}:undefined,
            };
          },spacingReview));
          record.pageErrors=[...pageErrors]; record.failedRequests=[...failedRequests];
          if (spacingReview || route===app.routes[0] || record.bodyOverflow || pageErrors.length) {
            const name=`${app.name}-${viewport.width}-${route.replace(/[^a-z0-9]/gi,'_')||'home'}.png`;
            await page.screenshot({path:path.join(output,name),fullPage:false});
          }
          record.passed=!record.bodyOverflow && !record.pageErrors.length && !record.duplicateIds.length && !record.unnamedControls.length && !record.failedRequests.length && record.mainCount===1 && !record.spacing?.issues.length;
          console.log(`${record.passed?'PASS':'REVIEW'} ${app.name} ${viewport.width} ${route}: ${record.unnamedControls.length} unnamed controls${record.bodyOverflow?', body overflow':''}${record.mainCount!==1?', main landmarks '+record.mainCount:''}${record.spacing?.issues.length?', '+record.spacing.issues.join('; '):''}`);
        } catch(error) {
          record.passed=false;record.error=error.message;console.log(`FAIL ${app.name} ${viewport.width} ${route}: ${error.message.split('\n')[0]}`);
        }
        results.push(record);
      }
      await context.close();
    }
  }
  }
  if (!baseline) {
    for(const app of apps.slice(0,4)) {
      const context=await browser.newContext({viewport:{width:390,height:844}});
      await context.addInitScript(token=>localStorage.setItem('app-access-token',token),accessToken);
      const page=await context.newPage();
      await page.goto(`http://127.0.0.1:${app.port}`+app.routes[0],{waitUntil:'networkidle'});
      const opener=page.getByRole('button',{name:'Open navigation',exact:true});
      await opener.click();
      const drawer=page.getByRole('dialog',{name:'Application navigation'});
      await drawer.waitFor();
      await page.waitForFunction(()=>document.querySelector('#application-navigation')?.contains(document.activeElement));
      const first=drawer.getByRole('link').first(), last=drawer.getByRole('link').last();
      await last.focus(); await page.keyboard.press('Tab');
      assert.equal(await first.evaluate(element=>element===document.activeElement),true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await last.evaluate(element=>element===document.activeElement),true);
      await drawer.locator('button.gear-nav-close').focus();
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-controls')==='application-navigation');
      await page.waitForFunction(()=>document.querySelector('.gear-topbar .menu-button')?.getAttribute('aria-expanded')==='false');
      assert.equal(await opener.getAttribute('aria-expanded'),'false');
      await opener.click();
      await drawer.getByRole('button',{name:'Close navigation',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.gear-topbar .menu-button')?.getAttribute('aria-expanded')==='false');
      assert.equal(await opener.getAttribute('aria-expanded'),'false');
      await page.goto(`http://127.0.0.1:${app.port}`+app.routes[0],{waitUntil:'networkidle'});
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Skip to main content');
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>document.activeElement?.id==='main-content');
      assert.ok(await page.locator('[aria-current="page"]').count()>0);
      if(app.name==='blade-tracking') {
        await page.goto(`http://127.0.0.1:${app.port}/admin?tab=users`,{waitUntil:'networkidle'});
        const section=page.locator('#admin-section');
        assert.equal(await section.isVisible(),true);
        await section.selectOption('access');
        await page.waitForURL('**/admin?tab=access');
        await section.selectOption('launch');
        await page.waitForURL('**/admin?tab=launch');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
      }
      interactions.push({app:app.name,drawerFocus:true,escapeReturn:true,internalClose:true,skipLink:true,currentPage:true});
      console.log('PASS '+app.name+' mobile drawer focus/Escape/close, skip link and current page');
      await context.close();
    }
    const context=await browser.newContext({viewport:{width:320,height:740}});
    await context.addInitScript(token=>localStorage.setItem('app-access-token',token),accessToken);
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:4204/',{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Plant overview',exact:true}).waitFor();
    await page.getByRole('searchbox',{name:'Find a machine'}).fill('NO-MACHINE-UI-REVIEW');
    const filters=page.getByRole('region',{name:'Machine filters'});
    await filters.locator('[role="status"]').filter({hasText:/^0 of/}).waitFor();
    await filters.getByRole('button',{name:'Clear filters',exact:true}).click();
    assert.equal(await page.getByRole('searchbox',{name:'Find a machine'}).inputValue(),'');
    await page.getByRole('tab',{name:'Reports',exact:true}).click();
    await page.getByRole('heading',{name:'Production reports',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    interactions.push({app:'plant-dashboard',width:320,clearFilters:true,reports:true,narrowLayout:true});
    await page.screenshot({path:path.join(output,'plant-dashboard-320-reports.png'),fullPage:false});
    console.log('PASS Plant Dashboard clear filters, reports and320px layout');
    await context.close();
  }
  // Shared login/recovery screens and the dedicated plant login at narrow phone width.
  for (const app of [apps[0],apps[4]]) {
    const context=await browser.newContext({viewport:{width:320,height:740}});
    const page=await context.newPage();
    for(const route of app.name==='plant-dashboard'?['/login']:['/login','/forgot-password','/reset-password']) {
      await page.goto(`http://127.0.0.1:${app.port}`+route,{waitUntil:'networkidle'});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
      results.push({app:app.name,width:320,route,bodyOverflow:overflow,passed:!overflow});
      await page.screenshot({path:path.join(output,`${app.name}-320-${route.slice(1)}.png`)});
    }
    await context.close();
  }
} catch(error) {interactionError=error;} finally {await browser.close();}
const failures=results.filter(result=>!result.passed);
const report={baseline,spacingReview,interactionRetry,screens:results.length,passed:results.length-failures.length,failures:failures.length,interactions,interactionError:interactionError?.message,results};
await fs.writeFile(path.join(output,baseline?'baseline.json':'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${report.passed}/${report.screens} route/viewport checks passed; report in ${path.relative(root,output)}.`);
if(interactionError) throw interactionError;
if(!baseline) assert.equal(failures.length,0,'Route/layout failures need review');
