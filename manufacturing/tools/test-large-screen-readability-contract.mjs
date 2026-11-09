import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const fail = (message) => { console.error(`[FAIL] ${message}`); process.exit(1); };
const need = (text, marker, label) => { if (!text.includes(marker)) fail(`${label} missing marker: ${marker}`); };

const responsivePath = 'vendor/dana-ui/package/styles/gear-apps/foundation/responsive.css';
const responsive = read(responsivePath);

for (const marker of [
  '@media (min-width: 1500px)',
  '--gear-sidebar-width: 296px;',
  '--gear-topbar-height: 76px;',
  '--gear-font-xs: 13px;',
  '--gear-font-sm: 15px;',
  '--gear-font-md: 17px;',
  '--gear-font-lg: 20px;',
  'max-width: 1840px;',
  '.gear-table th,',
  '.dashboard-table th',
  '.gear-table td,',
  '.dashboard-table td',
  'min-height: 52px;',
  '.blade-location-summary-card',
  '.inventory-detail-button',
  '.gear-topbar {',
  'minmax(420px, 720px)',
  '.side-link {',
  'font-size: 13px;',
  '.global-search {',
  'height: 48px;',
  '.global-search input {',
  'font-size: 14px;',
  '.avatar {',
  'width: 39px;',
]) need(responsive, marker, responsivePath);

const mediaStart = responsive.indexOf('@media (min-width: 1500px)');
if (mediaStart < 0) fail('Large-display media block is missing.');
const largeBlock = responsive.slice(mediaStart);

for (const marker of [
  '--gear-sidebar-width: 296px;',
  '--gear-topbar-height: 76px;',
  '--gear-font-md: 17px;',
  '.gear-topbar {',
  '.side-link {',
  '.global-search {',
]) need(largeBlock, marker, 'large-display media block');

console.log('[PASS] Large-screen readability contract passed: 1500px+ displays use a 13/15/17/20px body scale plus a modest 296px sidebar / 76px topbar shell scale.');
