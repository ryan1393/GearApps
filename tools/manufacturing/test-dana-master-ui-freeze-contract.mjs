import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { danaUiPublicApiText } from './lib/dana-ui-source.mjs';

const read = (p) => fs.readFileSync(contractPath(process.cwd(), p), 'utf8');
const must = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const barrel = danaUiPublicApiText();
const sharedStyles = read('libs/shared/dana-ui/src/styles/meshforge.css');
const gearStyles = read('libs/shared/dana-ui/src/styles/gear-compat-features.css');
const responsive = read('libs/shared/dana-ui/src/styles/meshforge/foundation/responsive.css');
const baseline = read('docs/manufacturing/DANA_MASTER_UI_BASELINE.md');
const runner = read('tools/manufacturing/run-all-tests.ps1');

const requiredExports = [
  'DanaPageHeaderComponent',
  'DanaOperationCardComponent',
  'DanaTableDirective',
  'DanaTableShellDirective',
  'DanaStatusBadgeDirective',
  'DanaCountBadgeDirective',
  'DanaEmptyStateDirective',
  'DanaLoadingStateDirective',
  'DanaButtonDirective',
  'DanaIconButtonDirective',
  'DanaToolbarDirective',
  'DanaAlertDirective',
  'DanaDetailGridDirective',
  'DanaTabsDirective',
  'DanaToastService',
  'DanaConfirmDialogComponent',
  'DanaMobileNavDirective',
  'DanaResponsiveGridDirective',
  'DanaStackDirective',
];

for (const name of requiredExports) {
  must(barrel.includes(name), `Dana master UI barrel missing ${name}`);
}

const gearOnlyCss = [
  'blade-dashboard.css',
  'cutter-builder.css',
  'greenshed-running-machines.css',
  'inventory-core.css',
  'inventory-relations.css',
  'scrap-blades.css',
];

for (const name of gearOnlyCss) {
  must(!sharedStyles.includes(name), `Dana shared stylesheet still owns Gear workflow CSS ${name}`);
  must(gearStyles.includes(name), `Gear domain stylesheet entry is missing ${name}`);
}

for (const marker of [
  '/* Dana responsive layout primitives - V69.2.6 */',
  '/* Dana responsive data surfaces - V69.2.7 */',
  '/* Dana responsive page layouts - V69.2.8 */',
  '@media (max-width: 1199px)',
  '@media (max-width: 767px)',
  '@media (max-width: 559px)',
]) {
  must(responsive.includes(marker), `Dana responsive foundation missing ${marker}`);
}

const navs = [
  ['apps/blade-tracking/src/app/layout/app-nav/app-nav.component.ts', 'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html'],
  ['apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.ts', 'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html'],
  ['apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.ts', 'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html'],
];

for (const [tsPath, htmlPath] of navs) {
  const ts = read(tsPath);
  const html = read(htmlPath);
  must(ts.includes('DanaMobileNavDirective'), `${tsPath} does not consume DanaMobileNavDirective`);
  for (const stale of ['mobileNavOpen = false', 'toggleMobileNav(): void', 'closeMobileNav(): void', 'closeMobileNavOnEscape(): void']) {
    must(!ts.includes(stale), `${tsPath} reintroduced duplicated mobile-nav state: ${stale}`);
  }
  for (const marker of ['danaMobileNav', '#mobileNav="danaMobileNav"', '[class.mobile-open]="mobileNav.open"', 'class="gear-nav-overlay"']) {
    must(html.includes(marker), `${htmlPath} missing shared mobile-nav marker ${marker}`);
  }
}

for (const project of ['blade-tracking', 'cutter-builder', 'greenshed']) {
  const cfg = JSON.parse(read(`apps/${project}/project.json`));
  const styles = cfg?.targets?.build?.options?.styles ?? [];
  const dana = 'libs/shared/dana-ui/src/styles/gear-compat.css';
  const gear = 'libs/shared/dana-ui/src/styles/gear-compat-features.css';
  const danaAt = styles.indexOf(dana);
  const gearAt = styles.indexOf(gear);
  must(danaAt >= 0, `${project} does not load Dana shared UI`);
  must(gearAt >= 0, `${project} does not load Gear domain UI`);
  must(danaAt < gearAt, `${project} must load Dana shared UI before Gear domain UI`);
}

for (const marker of [
  'Dana Apps Master UI Baseline',
  '`libs/shared/ui-tailwind` owns reusable Dana presentation',
  '`libs/gear/ui` owns Gear-specific workflow presentation',
  'Large data tables remain real tables',
]) {
  must(baseline.includes(marker), `Dana master UI baseline documentation missing ${marker}`);
}

for (const test of [
  'test-ux-responsive-navigation-contract.mjs',
  'test-dana-responsive-data-surface-contract.mjs',
  'test-dana-responsive-page-layout-contract.mjs',
  'test-dana-master-ui-freeze-contract.mjs',
]) {
  must(runner.includes(test), `Authoritative Gear runner missing ${test}`);
}

must(
  runner.includes("Add-MasterResult 'Dana master UI freeze contract' 'PASS'"),
  'Authoritative Gear runner does not record Dana master UI freeze PASS status.'
);

console.log(
  '[PASS] Dana master UI freeze contract: shared/domain ownership, responsive shell/data/page policies, style order, representative shared primitives, and Gear frontend adoption are locked for Dana Apps.'
);
