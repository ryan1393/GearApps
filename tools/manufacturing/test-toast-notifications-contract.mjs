import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readDanaUiSource } from './lib/dana-ui-source.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(contractPath(root, rel), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const compatService = read('libs/manufacturing/frontend/util-common/src/lib/toast/gear-toast.service.ts');
const compatHost = read('libs/manufacturing/frontend/util-common/src/lib/toast/gear-toast-host.component.ts');
const danaService = readDanaUiSource(root, 'lib/components/feedback/dana-toast.service.ts');
const danaHost = readDanaUiSource(root, 'lib/components/feedback/dana-toast-host.component.ts');
const sharedCss = read('vendor/dana-ui/package/styles/gear-apps.css');
const toastCss = read('vendor/dana-ui/package/styles/gear-apps/components/toast.css');
const utilIndex = read('libs/manufacturing/frontend/util-common/src/index.ts');
const danaIndex = readDanaUiSource(root, 'index.ts');

assert(
  compatService.includes("export { DanaToastService as GearToastService } from '@dana/ui';"),
  'GearToastService must remain a compatibility alias of the shared DanaToastService.'
);
assert(
  compatService.includes('DanaToastTone as GearToastTone'),
  'GearToastTone must remain a compatibility alias of DanaToastTone.'
);
assert(
  compatHost.includes("export { DanaToastHostComponent as GearToastHostComponent } from '@dana/ui';"),
  'GearToastHostComponent must remain a compatibility alias of DanaToastHostComponent.'
);

assert(danaService.includes("export type DanaToastTone = 'success' | 'warning' | 'error' | 'info'"), 'Dana toast service must support the four standard tones.');
assert(danaService.includes('.slice(-4)'), 'Dana toast stack must cap visible notices at four.');
assert(danaService.includes('globalThis.setTimeout'), 'Dana toast service must auto-dismiss notices.');
assert(danaHost.includes("selector: 'dana-toast-host, gear-toast-host'"), 'Dana toast host must preserve the legacy gear-toast-host selector during migration.');
assert(danaHost.includes('aria-live="polite"'), 'Dana toast host must announce notifications accessibly.');
assert(danaIndex.includes('DanaToastService') && danaIndex.includes('DanaToastHostComponent'), 'Dana UI barrel must export the toast API.');

assert(sharedCss.includes("@import './gear-apps/components/toast.css';"), 'Gear compatibility stylesheet must continue importing toast CSS during migration.');
assert(toastCss.includes('position: fixed;') && toastCss.includes('pointer-events: none;'), 'Toast stack must overlay without page reflow.');
assert(utilIndex.includes("export * from './lib/toast';"), 'Toast compatibility API must be exported by frontend util-common.');

for (const app of ['blade-tracking', 'cutter-builder', 'greenshed']) {
  const ts = read(`apps/${app}/src/app/app.component.ts`);
  const html = read(`apps/${app}/src/app/app.component.html`);
  assert(ts.includes('GearToastHostComponent'), `${app} root must import the compatibility toast host.`);
  assert((html.match(/<gear-toast-host/g) || []).length === 1, `${app} must mount exactly one toast host.`);
}

const actionFiles = [
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/intake/intake.component.ts',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/internal-movement/internal-movement.component.ts',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/load-container/load-container.component.ts',
  'libs/manufacturing/frontend/feature-blade-tracking/src/lib/pages/receive-container/receive-container.component.ts',
  'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.ts',
  'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/teardown/cutter-teardown.component.ts',
  'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/setup/greenshed-setup.component.ts',
  'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/check/greenshed-check.component.ts',
  'libs/manufacturing/frontend/feature-greenshed/src/lib/pages/pull/greenshed-pull.component.ts',
  'libs/manufacturing/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.ts',
];
for (const rel of actionFiles) {
  const source = read(rel);
  assert(source.includes('GearToastService'), `${rel} must continue using the compatibility toast service.`);
}

const legacyPath = contractPath(root, 'libs/manufacturing/frontend/util-common/src/lib/directives/upsert-dialog-directive/upsert-dialog.directive.ts');
if (fs.existsSync(contractPath(process.cwd(), legacyPath))) {
const legacyDirective = read('libs/manufacturing/frontend/util-common/src/lib/directives/upsert-dialog-directive/upsert-dialog.directive.ts');
const upsertActionType = read('libs/manufacturing/frontend/util-common/src/lib/directives/upsert-dialog-directive/upsert-dialog-data.interface.ts');
assert(!legacyDirective.includes('HotToastService'), 'Legacy upsert flow must not bypass the Dana/Gear toast system.');
assert(legacyDirective.includes('GearToastService'), 'Legacy upsert flow must use the compatibility toast service.');
assert(upsertActionType.includes("export type UpsertDialogDataActionType = 'add' | 'edit'"), 'Upsert action contract must remain add/edit.');
assert(legacyDirective.includes("this.action === 'add' ? 'Created' : 'Updated'"), 'Upsert toast title must use the valid add/edit action literals.');
assert(!legacyDirective.includes("this.action === 'create'"), 'Upsert toast logic must not compare add/edit action data to an invalid create literal.');

} else {
  const directiveExports=read('libs/manufacturing/frontend/util-common/src/lib/directives/index.ts');
  assert(!directiveExports.includes('upsert-dialog.directive'), 'A retired dialog directive must not remain exported');
  for (const rel of actionFiles) {
    const source=read(rel);
    assert(!source.includes('UpsertDialogDirective') && !source.includes('HotToastService'), `${rel} must use the native form and Dana toast flow`);
  }
}

const brandCss = read('vendor/dana-ui/package/styles/gear-apps/layout/brand.css');
const responsiveCss = read('vendor/dana-ui/package/styles/gear-apps/foundation/responsive.css');
assert(/dana-diamond-mark[\s\S]*?width:\s*56px;[\s\S]*?height:\s*38px;/.test(brandCss), 'Normal Dana Diamond must remain 56x38.');
assert(/dana-diamond-mark[\s\S]*?width:\s*64px;[\s\S]*?height:\s*44px;/.test(responsiveCss), 'Large-screen Dana Diamond must remain 64x44.');

console.log('[PASS] Dana/Gear compatibility toast contract: shared Dana toast owns behavior, legacy Gear aliases remain intact, and all transaction wiring is preserved.');
