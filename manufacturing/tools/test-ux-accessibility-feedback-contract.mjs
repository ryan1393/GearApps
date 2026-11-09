import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(contractPath(process.cwd(), p),'utf8');
const scanTs=read('libs/frontend/feature-blade-tracking/src/lib/shared/scan-panel/scan-panel.component.ts');
const scanHtml=read('libs/frontend/feature-blade-tracking/src/lib/shared/scan-panel/scan-panel.component.html');
for(const m of ['implements AfterViewInit','@Input() autoFocus = true','readonly inputId','ngAfterViewInit()']) if(!scanTs.includes(m)) throw new Error(`Shared scan autofocus missing ${m}`);
for(const m of ['[for]="inputId"','[id]="inputId"']) if(!scanHtml.includes(m)) throw new Error(`Shared scan label association missing ${m}`);
const css=read('vendor/dana-ui/package/styles/gear-apps/components/primitives.css');
if(!css.includes(':focus-visible')) throw new Error('Shared focus-visible styling missing.');
const loginTs=read('libs/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.ts');
const loginHtml=read('libs/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.html');
if(!loginTs.includes('submitting = false') || !loginHtml.includes("Signing in…") || !loginHtml.includes('[disabled]="submitting"')) throw new Error('Login submit lock/progress feedback missing.');
const feedbackPages=[
 'libs/frontend/feature-greenshed/src/lib/pages/setup/greenshed-setup.component.html',
 'libs/frontend/feature-greenshed/src/lib/pages/check/greenshed-check.component.html',
 'libs/frontend/feature-greenshed/src/lib/pages/pull/greenshed-pull.component.html',
 'libs/frontend/feature-blade-tracking/src/lib/pages/load-container/load-container.component.html',
];
for(const file of feedbackPages){const html=read(file);if(!html.includes('role="alert"')&&!html.includes("[attr.role]"))throw new Error(`${file} lacks alert semantics`);}
for(const file of ['apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html','apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html','apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html']){
 if(!read(file).includes('aria-label=')) throw new Error(`${file} global search/menu lacks accessible labels`);
}
console.log('[PASS] UX accessibility/feedback contract passed: scan labels/autofocus, focus-visible, live feedback, and submit locking are present.');
