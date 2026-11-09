import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const must = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const responsive = read('vendor/dana-ui/package/styles/gear-apps/foundation/responsive.css');
const header = read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const toolbar = read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const detail = read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const grid = read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const stack = read('vendor/dana-ui/package/fesm2022/dana-ui.mjs');
const runner = read('tools/run-all-tests.ps1');

must(
  header.includes("class: 'dana-page-header gear-page-header'"),
  'DanaPageHeaderComponent must retain Dana canonical ownership and Gear compatibility alias.'
);
must(
  toolbar.includes("class: 'dana-toolbar gear-actions'"),
  'DanaToolbarDirective must retain Dana canonical ownership and Gear compatibility alias.'
);
must(
  detail.includes("class: 'dana-detail-grid gear-detail-grid'"),
  'DanaDetailGridDirective must retain Dana canonical ownership and Gear compatibility alias.'
);
must(grid.includes("selector: '[danaResponsiveGrid]'"), 'DanaResponsiveGridDirective baseline is missing.');
must(stack.includes("selector: '[danaStack]'"), 'DanaStackDirective baseline is missing.');

for (const marker of [
  '/* Dana responsive page layouts - V69.2.8 */',
  '.dana-page-header',
  '.dana-toolbar',
  '.dana-detail-grid',
  '@media (max-width: 767px)',
  '@media (max-width: 559px)',
  'flex-direction: column',
  'grid-template-columns: 1fr',
]) {
  must(responsive.includes(marker), `Responsive page-layout CSS missing ${marker}`);
}

must(
  runner.includes('test-dana-responsive-page-layout-contract.mjs'),
  'Authoritative Gear runner does not include Dana responsive page-layout contract.'
);
must(
  runner.includes("Add-MasterResult 'Dana responsive page layout contract' 'PASS'"),
  'Authoritative Gear runner does not record Dana responsive page-layout PASS status.'
);

console.log(
  '[PASS] Dana responsive page layout contract: page headers, action toolbars, detail grids, responsive grid, and stack primitives share one mobile layout policy.'
);
