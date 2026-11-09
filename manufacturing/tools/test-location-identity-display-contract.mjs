import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const fail = (message) => { console.error(`[FAIL] ${message}`); process.exit(1); };
const requireText = (text, marker, label) => { if (!text.includes(marker)) fail(`${label} missing marker: ${marker}`); };
const forbidText = (text, marker, label) => { if (text.includes(marker)) fail(`${label} still contains unsafe location-number display: ${marker}`); };

const movementTsPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/internal-movement/internal-movement.component.ts';
const movementHtmlPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/internal-movement/internal-movement.component.html';
const trayContentsPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/tray-contents/tray-contents.component.html';
const lookupPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html';
const overviewPath = 'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html';
const teardownPath = 'libs/frontend/feature-cutter-builder/src/lib/pages/teardown/cutter-teardown.component.html';
const pullPath = 'libs/frontend/feature-greenshed/src/lib/pages/pull/greenshed-pull.component.html';

const movementTs = read(movementTsPath);
const movementHtml = read(movementHtmlPath);
const trayContents = read(trayContentsPath);
const lookup = read(lookupPath);
const overview = read(overviewPath);
const teardown = read(teardownPath);
const pull = read(pullPath);

// Physical placement identity is the scannable location serial/tag, never locations.number.
for (const [text, marker, label] of [
  [movementTs, 'current.location.number', movementTsPath],
  [movementTs, 'destination.number', movementTsPath],
  [movementHtml, 'current?.location?.number', movementHtmlPath],
  [movementHtml, 'destination.number', movementHtmlPath],
  [trayContents, 'd.location?.location?.number', trayContentsPath],
  [lookup, 't.current_location.description || t.current_location.number', lookupPath],
  [overview, 'tray.current_location.description || tray.current_location.number', overviewPath],
  [teardown, 'shelfLocation.description || shelfLocation.number', teardownPath],
  [pull, 'shelf.description||shelf.number', pullPath],
]) forbidText(text, marker, label);

requireText(movementTs, 'current.location.serial_number', movementTsPath);
requireText(movementTs, 'destination.serial_number', movementTsPath);
requireText(movementHtml, 'current?.location?.serial_number', movementHtmlPath);
requireText(movementHtml, 'destination.serial_number', movementHtmlPath);
requireText(trayContents, 'd.location?.location?.serial_number', trayContentsPath);
requireText(lookup, 't.current_location.serial_number', lookupPath);
requireText(overview, 'tray.current_location.serial_number', overviewPath);
requireText(teardown, 'shelfLocation.serial_number', teardownPath);
requireText(pull, 'shelf.serial_number', pullPath);

// locations.number remains valid master/reference metadata and validation data; it just cannot masquerade as shelf identity.
const allowedMasterViews = [
  'libs/frontend/feature-blade-tracking/src/lib/pages/locations/blade-locations.component.html',
  'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-overview/inventory-overview.component.html',
  'libs/frontend/feature-admin-users/src/lib/frontend-feature-admin-users/frontend-feature-admin-users.component.html',
  'libs/frontend/feature-blade-tracking/src/lib/pages/inventory-lookup/inventory-lookup.component.html',
];
for (const rel of allowedMasterViews) {
  if (!fs.existsSync(path.join(root, rel))) fail(`Expected location master view missing: ${rel}`);
}

console.log('[PASS] Location identity display contract passed: operator-facing physical placements use location serial/tag; location.number remains metadata/validation only.');
