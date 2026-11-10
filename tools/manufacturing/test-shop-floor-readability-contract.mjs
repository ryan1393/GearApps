import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(contractPath(root, rel), 'utf8');
const fail = (message) => { console.error(`[FAIL] ${message}`); process.exit(1); };
const need = (text, marker, label) => { if (!text.includes(marker)) fail(`${label} missing marker: ${marker}`); };

const tokensPath = 'libs/shared/dana-ui/src/styles/gear-apps/foundation/tokens.css';
const primitivesPath = 'libs/shared/dana-ui/src/styles/gear-apps/components/primitives.css';
const dataPath = 'libs/shared/dana-ui/src/styles/gear-apps/components/data-display.css';
const relationsPath = 'libs/shared/dana-ui/src/styles/gear-apps/features/inventory-relations.css';
const navPath = 'libs/shared/dana-ui/src/styles/gear-apps/layout/navigation-shell.css';

const tokens = read(tokensPath);
const primitives = read(primitivesPath);
const data = read(dataPath);
const relations = read(relationsPath);
const nav = read(navPath);

for (const marker of [
  '--gear-font-xs: 11px;',
  '--gear-font-sm: 12px;',
  '--gear-font-md: 14px;',
  '--gear-font-lg: 16px;',
]) need(tokens, marker, tokensPath);

for (const marker of [
  'font-size: var(--gear-font-md);',
  '.gear-btn',
  '.gear-field',
]) need(primitives, marker, primitivesPath);

for (const marker of [
  '.gear-table',
  'font-size: var(--gear-font-sm);',
  '.status-pill',
  'font-size: var(--gear-font-xs);',
]) need(data, marker, dataPath);

for (const marker of [
  '.inventory-child-card',
  'max-width: 100%;',
  'overflow: hidden;',
  'grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, 1.05fr);',
  '.inventory-child-row > *',
  'overflow-wrap: anywhere;',
  'word-break: break-word;',
  'font-size: var(--gear-font-sm);',
]) need(relations, marker, relationsPath);

if (relations.includes('grid-template-columns: minmax(90px, 1.2fr) minmax(80px, 1fr) minmax(100px, 1.2fr);')) {
  fail('Legacy fixed-minimum child-row columns remain and can overflow narrow child cards.');
}

if (relations.includes('font-size: 8px;') || relations.includes('font-size: 9px;')) {
  fail('Parent/child inventory drilldowns still contain 8px/9px body text.');
}

// The body readability pass must not redesign the stable desktop shell.
if (!nav.includes('--gear-sidebar-width') && !nav.includes('.gear-sidebar')) {
  fail('Navigation shell no longer appears to be the established Gear Apps shell.');
}

const relationsLines = relations.split(/\r?\n/).length;
if (relationsLines > 520) {
  fail(`inventory-relations.css grew to ${relationsLines} lines; keep the shared module under the 520-line ceiling.`);
}

console.log(
  `[PASS] Shop-floor readability contract passed: shared body typography uses the 11/12/14/16px scale, ` +
  `parent/child rows are width-contained/wrappable, and inventory-relations.css is ${relationsLines} lines.`,
);
