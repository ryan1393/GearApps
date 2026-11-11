import { readMeshForgeStyles } from './lib/read-meshforge-styles.mjs';
import {
  summarizeContextualSelectorDuplicates,
  summarizeSelectorDuplicates,
} from './lib/css-selector-audit.mjs';

const css = readMeshForgeStyles();
const raw = summarizeSelectorDuplicates(css);
const contextual = summarizeContextualSelectorDuplicates(css);

console.log(`MeshForge CSS rules: ${raw.totalRules}`);
console.log(`Unique selector strings: ${raw.uniqueSelectors}`);
console.log(`Same-cascade duplicate selectors: ${contextual.duplicateSelectorCount}`);
console.log(`Selectors intentionally reused across responsive/print contexts: ${raw.duplicateSelectorCount}`);

if (contextual.duplicates.length) {
  console.log('\nSame-cascade duplicate debt:');
  for (const [selector, count] of contextual.duplicates) {
    console.log(`${String(count).padStart(2, ' ')}x  ${selector}`);
  }
}

if (raw.duplicates.length) {
  console.log('\nResponsive/context reuse ledger:');
  for (const [selector, count] of raw.duplicates) {
    console.log(`${String(count).padStart(2, ' ')}x  ${selector}`);
  }
}
