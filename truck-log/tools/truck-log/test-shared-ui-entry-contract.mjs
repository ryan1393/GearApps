import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`[PASS] ${message}`);
};

const appStylesPath = 'apps/truck-log/src/styles.css';
const entryPath = 'libs/truck-log/web/styles/src/styles/truck-log.css';
const canonicalLogo = 'apps/truck-log/src/assets/branding/dana-diamond.png';
const duplicateLogo = 'apps/truck-log/public/assets/branding/dana-diamond.png';
const danaEntry = 'node_modules/@dana/ui/styles/dana-ui.css';

for (const relative of [appStylesPath, entryPath, danaEntry, canonicalLogo]) {
  must(exists(relative), `Shared UI cleanup file exists: ${relative}`);
}

const appStyles = read(appStylesPath).trim();
must(
  appStyles === '@import "../../../libs/truck-log/web/styles/src/styles/truck-log.css";',
  'Angular app imports exactly one public Truck Log UI stylesheet entry',
);

// Dana UI owns tokens, base, shell and primitives and is loaded first; Truck Log's entry layers
// one layout-only file per area on top of it.
const expectedImports = [
  './shell.css',
  './ui.css',
  './auth.css',
  './operations.css',
  './check-in.css',
  './dock-board.css',
  './records.css',
  './rxo.css',
  './tv.css',
  './admin.css',
];
const entry = read(entryPath);
const imports = [...entry.matchAll(/@import\s+["']([^"']+)["'];/g)].map((match) => match[1]);
must(JSON.stringify(imports) === JSON.stringify(expectedImports), 'Public Truck Log UI import graph and cascade order are canonical');
must(new Set(imports).size === imports.length, 'Public Truck Log UI entry has no duplicate imports');
const stylesDir = path.dirname(path.join(root, entryPath));
for (const relative of imports) {
  const resolved = path.join(stylesDir, relative);
  must(fs.existsSync(resolved), `Public UI import target exists: ${relative}`);
  must(!fs.readFileSync(resolved, 'utf8').includes('@import'), `${relative} contains rules only and cannot create an import cycle`);
}
const orphaned = fs.readdirSync(stylesDir).filter((name) => name.endsWith('.css') && name !== 'truck-log.css' && !imports.includes(`./${name}`));
must(!orphaned.length, `Every Truck Log stylesheet is reachable from the public entry${orphaned.length ? `: ${orphaned.join(', ')}` : ''}`);
must(!fs.readdirSync(stylesDir, { withFileTypes: true }).some((item) => item.isDirectory()), 'Retired gear-source/ and global-polish/ style trees are gone');

const project = JSON.parse(read('apps/truck-log/project.json'));
const buildStyles = project.targets?.build?.options?.styles ?? [];
must(JSON.stringify(buildStyles) === JSON.stringify([danaEntry, appStylesPath]), 'Angular build loads Dana UI first, then the single Truck Log entry');
// Retired pre-Dana shell rules must not come back in Truck Log CSS.
const allTruckLogCss = imports.map((relative) => fs.readFileSync(path.join(stylesDir, relative), 'utf8')).join('\n');
for (const retired of [':root', '.shell{', '.sidebar{', '.topbar{', '.nav-item{', '.main{', '.panel{', '.gear-']) {
  must(!allTruckLogCss.includes(retired), `Truck Log CSS no longer carries ${retired} (owned by Dana UI)`);
}

must(!exists(duplicateLogo), 'Duplicate public Dana Diamond asset is removed');
const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, canonicalLogo))).digest('hex').toUpperCase();
must(hash === '6B3D9387F6E90C90B7E599E20853F09C3471C65B7756D648595AD1F58D1E03E9', 'Canonical Dana Diamond asset is the approved artwork');

const assets = project.targets?.build?.options?.assets ?? [];
const coversSourceAssets = assets.some((asset) =>
  typeof asset === 'string' && asset.replaceAll('\\', '/').replace(/\/$/, '') === 'apps/truck-log/src/assets',
);
must(coversSourceAssets, 'Angular build copies the canonical src/assets directory');

console.log('[PASS] Truck Log single public UI entry and asset-deduplication contract passed.');
