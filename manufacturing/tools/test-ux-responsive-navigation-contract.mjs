import fs from 'node:fs';
import { readDanaUiSource } from './lib/dana-ui-source.mjs';
const read=(p)=>fs.readFileSync(p,'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const navCss=read('vendor/dana-ui/package/styles/gear-apps/layout/navigation-shell.css');
const responsive=read('vendor/dana-ui/package/styles/gear-apps/foundation/responsive.css');
const appShell=read('vendor/dana-ui/package/styles/gear-apps/layout/app-shell.css');
const mobile=read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const mobileSource=readDanaUiSource(process.cwd(),'lib/components/navigation/dana-mobile-nav.directive.ts');
const grid=read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const stack=read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const barrel=read('vendor/dana-ui/package/index.d.ts');

for(const marker of ['.gear-sidebar.mobile-open','transform: translateX(-105%)','.gear-nav-overlay','@media (min-width: 1024px)','grid-template-columns: auto minmax(0, 1fr) auto']) must(navCss.includes(marker),'Responsive navigation CSS missing '+marker);
must(appShell.includes('padding-top: var(--gear-topbar-height)'),'Mobile content shell must reserve topbar height.');
for(const marker of ["selector: '[danaMobileNav]'","exportAs: 'danaMobileNav'","document:keydown.escape","window:resize"]) must(mobile.includes(marker),'DanaMobileNavDirective missing '+marker);
must(/@Input\(\)\s+desktopMinWidth\s*=\s*1025/.test(mobileSource),'Dana mobile navigation must expose its shared CSS desktop breakpoint.');
must(mobileSource.includes('Number.isSafeInteger')&&mobileSource.includes('window.matchMedia(`(min-width: ${width}px)`)'),'Dana mobile navigation must validate and use the configured breakpoint.');
for(const marker of ["selector: '[danaResponsiveGrid]'","class.dana-responsive-grid","--dana-grid-columns","--dana-grid-compact-columns","--dana-grid-mobile-columns"]) must(grid.includes(marker),'DanaResponsiveGridDirective missing '+marker);
for(const marker of ["selector: '[danaStack]'","class.dana-stack","class.dana-stack-mobile","--dana-stack-gap"]) must(stack.includes(marker),'DanaStackDirective missing '+marker);
for(const marker of ['/* Dana responsive layout primitives - V69.2.6 */','.dana-responsive-grid','.dana-stack','@media (max-width: 1199px)','@media (max-width: 767px)']) must(responsive.includes(marker),'Shared responsive CSS missing '+marker);
for(const marker of ['DanaMobileNavDirective','DanaResponsiveGridDirective','DanaStackDirective']) must(barrel.includes(marker),'Shared UI barrel missing '+marker);

const navs=[
 ['apps/blade-tracking/src/app/layout/app-nav/app-nav.component.ts','apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html'],
 ['apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.ts','apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html'],
 ['apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.ts','apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html'],
];
for(const [tsPath,htmlPath] of navs){
 const ts=read(tsPath),html=read(htmlPath);
 must(ts.includes('DanaMobileNavDirective'),tsPath+' must import the shared mobile-nav directive.');
 for(const stale of ['mobileNavOpen','toggleMobileNav(','closeMobileNav(','closeMobileNavOnEscape(']) must(!ts.includes(stale),tsPath+' still duplicates '+stale);
 for(const marker of ['danaMobileNav','[desktopMinWidth]="1024"','#mobileNav="danaMobileNav"','[class.mobile-open]="mobileNav.open"','class="gear-nav-overlay"','[attr.aria-expanded]="mobileNav.open"','(click)="mobileNav.toggle()"']) must(html.includes(marker),htmlPath+' missing '+marker);
}
console.log('[PASS] UX responsive navigation contract passed: all three Gear apps use one Dana mobile-nav controller with shared overlay/Escape/desktop-reset behavior, plus reusable responsive grid/stack primitives.');
