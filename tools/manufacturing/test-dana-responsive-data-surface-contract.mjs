import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import { danaUiBundleText } from './lib/dana-ui-source.mjs';

const read = (p) => fs.readFileSync(contractPath(process.cwd(), p), 'utf8');
const must = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const shell = danaUiBundleText();
const responsive = read('libs/shared/dana-ui/src/styles/gear-apps/foundation/responsive.css');
const runner = read('tools/manufacturing/run-all-tests.ps1');

for (const marker of [
  "selector: '[danaTableShell]'",
  "class.dana-table-shell",
]) {
  must(shell.includes(marker), `DanaTableShellDirective missing ${marker}`);
}

for (const marker of [
  '/* Dana responsive data surfaces - V69.2.7 */',
  '.dana-table-shell',
  '.gear-page .table-wrap',
  'overflow-x: auto',
  'overscroll-behavior-inline: contain',
  '-webkit-overflow-scrolling: touch',
  '@media (max-width: 767px)',
  'min-width: 680px',
]) {
  must(responsive.includes(marker), `Responsive data-surface CSS missing ${marker}`);
}

must(
  runner.includes('test-dana-responsive-data-surface-contract.mjs'),
  'Authoritative Gear runner does not include the Dana responsive data-surface contract.'
);
must(
  runner.includes("Add-MasterResult 'Dana responsive data surface contract' 'PASS'"),
  'Authoritative Gear runner does not record Dana responsive data-surface PASS status.'
);

console.log(
  '[PASS] Dana responsive data surface contract: shared table shells own horizontal overflow/touch behavior and mobile tables retain readable minimum width.'
);
