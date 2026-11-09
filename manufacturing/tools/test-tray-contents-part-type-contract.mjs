import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(contractPath(root, rel), 'utf8');
const fail = (message) => { console.error(`[FAIL] ${message}`); process.exit(1); };
const requireText = (text, marker, label) => { if (!text.includes(marker)) fail(`${label} missing marker: ${marker}`); };

const tsPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.ts';
const htmlPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html';
const ts = read(tsPath);
const html = read(htmlPath);

// Tray Contents must show the tray business identity immediately, not just the Summary.
requireText(html, '<small>Summary</small>', htmlPath);
requireText(html, '<small>Part Type</small>', htmlPath);
requireText(html, '{{ traySummary }}', htmlPath);
requireText(html, '{{ trayPartType }}', htmlPath);
requireText(html, 'Blade Contents', htmlPath);
requireText(html, "{{ assignment.blade.part_type?.code || trayPartType }}", htmlPath);
requireText(html, 'Summary / Part Type totals:', htmlPath);

// Blade grouping must preserve Summary + Part Type as distinct business keys.
requireText(ts, 'summary: string; partType: string; count: number', tsPath);
requireText(ts, "blade?.part_type?.code", tsPath);
requireText(ts, "this.details?.tray.part_type?.code", tsPath);
requireText(ts, 'const key = `${summary}::${partType}`;', tsPath);

// Key tray-facing Blade Tracking views should pair Summary and Part Type when both are relevant.
const pairedViews = [
  'libs/frontend/feature-blade-tracking/src/lib/pages/internal-movement/internal-movement.component.html',
  'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html',
  'libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html',
  'libs/frontend/feature-blade-tracking/src/lib/pages/scrap-blades/scrap-blades.component.html',
];
for (const rel of pairedViews) {
  const text = read(rel);
  if (!/part[_ -]?type|part type/i.test(text)) fail(`${rel} no longer exposes Part Type alongside tray/blade Summary context.`);
}

console.log('[PASS] Tray Contents Part Type contract passed: scanned tray details and blade groups expose Summary + Part Type together.');
