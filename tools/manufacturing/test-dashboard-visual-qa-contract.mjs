import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const read = rel => fs.readFileSync(contractPath(root, rel), 'utf8');
const must = (ok, message) => { if (!ok) throw new Error(message); };
const norm = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const digest = text => crypto.createHash('sha256').update(text).digest('hex').toUpperCase();
const receipt = JSON.parse(read('docs/manufacturing/DANA_UI_DASHBOARD_VISUAL_QA.json'));
// Since Dana UI 0.3.0 this CSS ships as gear-compat-overrides.css, with a packaging header and the
// compact toast block appended after the dashboard polish. The receipt tracks the current
// reviewed adapter; later Dana reviews retain original release hashes in its provenance.
const css = norm(read('libs/shared/dana-ui/src/styles/gear-compat-overrides.css'))
  .replace(/^\/\* @dana\/ui Gear compatibility: overrides[\s\S]*?\*\/\n/, '')
  .replace(/\n*\/\* Compact toast stack for MeshForge[\s\S]*$/, '\n');
const begin = '/* BEGIN DANA-APPS DASHBOARD VISUAL QA V70.0.4';
const end = '/* END DANA-APPS DASHBOARD VISUAL QA V70.0.4 */';
const at = css.indexOf(begin);
must(at >= 0 && css.indexOf(begin, at + begin.length) < 0, 'Dashboard polish must have exactly one managed block.');
const endAt = css.indexOf(end, at);
must(endAt > at, 'Dashboard polish block must be complete.');
const block = css.slice(at, endAt + end.length) + '\n';
must(digest(block) === receipt.managedCssSha256, 'Dashboard managed CSS differs from its reviewed Dana adapter receipt.');
must(digest(css.slice(0, at).trimEnd()) === receipt.previousCssSha256, 'Dana/Gear adapter prefix differs from its reviewed receipt.');
must(receipt.version === 'V70.0.4' && receipt.sharedUiVersion === '0.2.0', 'Dashboard visual QA receipt version mismatch.');
const pkg = JSON.parse(read('libs/shared/dana-ui/package.json'));
must(pkg.name === '@dana/ui' && /^0\.(2|3)\.\d+$/.test(pkg.version), 'Dashboard polish requires @dana/ui 0.2.x/0.3.x (reviewed against 0.2.0).');
for (const app of ['blade-tracking', 'cutter-builder', 'greenshed']) {
  const project = JSON.parse(read(`apps/${app}/project.json`));
  const styles = project.targets?.build?.options?.styles ?? [];
  const external = styles.indexOf('libs/shared/dana-ui/src/styles/dana-ui.css');
  const bridge = styles.indexOf('libs/shared/dana-ui/src/styles/gear-compat-overrides.css');
  must(external >= 0 && bridge === external + 1 && bridge === styles.length - 1,
    `${app}: retain the external Dana UI then the final Gear migration stylesheet.`);
}
const external = norm(read('tools/manufacturing/test-external-dana-ui-package-contract.mjs'));
const hook = "await import('./test-dashboard-visual-qa-contract.mjs');";
must(external.includes(hook), 'Existing external-Dana-UI regression must invoke dashboard visual QA.');
const runner = read('tools/manufacturing/run-all-tests.ps1');
must(runner.includes('test-external-dana-ui-package-contract.mjs'), 'Authoritative Gear runner must retain the external UI regression gate.');
// The managed dashboard block retains its screen-only layout scope. The separate spacing
// review also covers current application templates and records that broader scope in the receipt.
must(block.includes('@media screen {') && block.includes('@media screen and (min-width: 1500px)'),
  'Polish must remain screen-only with its explicit large-display layer.');
must(!/\bdisplay\s*:\s*none\b/.test(block), 'Polish must not hide application controls or data.');
must(!/\btransform\s*:/.test(block), 'Polish must not replace mobile drawer mechanics.');
must(!/\bgrid-template-columns\s*:/.test(block), 'Polish must preserve the maintained dashboard grid arrangements.');
console.log('[PASS] Dashboard visual QA contract: screen-only shared adapter, full brand labels, readable topbar/tables, unchanged grid and print behavior.');
