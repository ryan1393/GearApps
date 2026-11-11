import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { readGearAppsStyles } from './lib/read-gear-apps-styles.mjs';

for(const [app,nav] of [
  ['blade-tracking','gear-nav'],
  ['cutter-builder','gear-cutter-builder-nav'],
  ['greenshed','gear-greenshed-nav'],
]){
  const ts=fs.readFileSync(contractPath(process.cwd(), `apps/${app}/src/app/app.component.ts`),'utf8');
  const html=fs.readFileSync(contractPath(process.cwd(), `apps/${app}/src/app/app.component.html`),'utf8');
  const css=fs.readFileSync(contractPath(process.cwd(), `apps/${app}/src/app/app.component.css`),'utf8');
  if(!ts.includes('get isLoginRoute(): boolean')) throw new Error(`${app}: missing isLoginRoute`);
  if(!html.includes('@if (!isLoginRoute)') || !html.includes(`<${nav} />`)) throw new Error(`${app}: nav must hide on login`);
  if(!html.includes('[class.login-shell]="isLoginRoute"')) throw new Error(`${app}: login shell marker missing`);
  const localRules=css.replace(/\/\*[\s\S]*?\*\//g,'').trim();
  if(localRules) throw new Error(`${app}: app shell styling must come from the central MeshForge stylesheet.`);
}

const login=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.html'),'utf8');
const componentStyle=fs.readFileSync(contractPath(process.cwd(), 'libs/manufacturing/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.scss'),'utf8');
const sharedStyle=readGearAppsStyles();

for(const marker of ['MESHFORGE','Connected Manufacturing Platform','Blade Tracking.','Cutter Builder.','Greenshed.','Sign in to MeshForge','Local accounts','>Operator<','>Admin<']){
  if(!login.includes(marker)) throw new Error(`Shared login missing ${marker}`);
}
if(login.includes('tailwindui.com') || login.includes('Your Company')) throw new Error('Old placeholder login brand remains');

const privateRules=componentStyle.replace(/\/\*[\s\S]*?\*\//g,'').trim();
if(privateRules) throw new Error('Login component styling must come from the central MeshForge stylesheet.');
for(const marker of ['.app-content-shell.login-shell','.login-page','.login-brand-panel','.login-form-panel','.login-card','.login-submit']){
  if(!sharedStyle.includes(marker)) throw new Error(`Central MeshForge stylesheet missing ${marker}`);
}
console.log('[PASS] Login UI consistency contract passed.');
