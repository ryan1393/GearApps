import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const indexPath = path.join(root, 'apps/truck-log/src/index.html');
const projectPath = path.join(root, 'apps/truck-log/project.json');
const exactLogoPath = path.join(root, 'apps/truck-log/src/assets/branding/dana-diamond.png');
const faviconPngPath = path.join(root, 'apps/truck-log/src/assets/branding/dana-favicon.png');
const faviconIcoPath = path.join(root, 'apps/truck-log/src/favicon.ico');

function must(condition, message) {
  if (!condition) throw new Error(message);
}
function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}
function hasAssetCoverage(assets, sourceRel) {
  const normalized = sourceRel.replaceAll('\\', '/');
  return assets.some((asset) => {
    if (typeof asset === 'string') {
      const s = asset.replaceAll('\\', '/').replace(/\/+$/, '');
      if (s === normalized) return true;
      if (normalized.startsWith(`${s}/`)) return true;
      return false;
    }
    if (!asset || typeof asset !== 'object') return false;
    const input = String(asset.input || '').replaceAll('\\', '/').replace(/\/+$/, '');
    const glob = String(asset.glob || '');
    if (!input) return false;
    if (!normalized.startsWith(`${input}/`) && normalized !== input) return false;
    if (glob === '**/*' || glob === '*' || glob === 'favicon.ico') return true;
    return false;
  });
}

for (const file of [indexPath, projectPath, exactLogoPath, faviconPngPath, faviconIcoPath]) {
  must(fs.existsSync(file), `Missing favicon source: ${path.relative(root, file)}`);
}

const html = fs.readFileSync(indexPath, 'utf8');
must(/<link\b[^>]*rel=["']icon["'][^>]*href=["']assets\/branding\/dana-favicon\.png["'][^>]*>/i.test(html)
  || /<link\b[^>]*href=["']assets\/branding\/dana-favicon\.png["'][^>]*rel=["']icon["'][^>]*>/i.test(html),
  'index.html does not declare the Dana PNG favicon.');
must(/<link\b[^>]*href=["']favicon\.ico["'][^>]*>/i.test(html),
  'index.html does not declare favicon.ico fallback.');
must(!/https?:\/\/[^"']+favicon/i.test(html), 'Favicon must not depend on an external URL.');
const iconLinks = [...html.matchAll(/<link\b[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*>/gi)].map((m) => m[0]);
must(iconLinks.length === 2, `Expected exactly 2 authoritative favicon link tags; found ${iconLinks.length}.`);
for (const tag of iconLinks) {
  must(/href=["'](?:assets\/branding\/dana-favicon\.png|favicon\.ico)["']/i.test(tag),
    `Unexpected favicon declaration remains: ${tag}`);
}

must(
  sha(exactLogoPath) === '6B3D9387F6E90C90B7E599E20853F09C3471C65B7756D648595AD1F58D1E03E9',
  'Truck Log Dana Diamond PNG is not the approved exact artwork.'
);
const png = fs.readFileSync(faviconPngPath);
must(png.length > 1000 && png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  'Dana favicon PNG is invalid.');
const ico = fs.readFileSync(faviconIcoPath);
must(ico.length > 1000 && ico[0] === 0 && ico[1] === 0 && ico[2] === 1 && ico[3] === 0,
  'Dana favicon ICO is invalid.');

const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const assets = project?.targets?.build?.options?.assets;
must(Array.isArray(assets), 'Truck Log build assets array is missing.');
must(hasAssetCoverage(assets, 'apps/truck-log/src/favicon.ico'),
  'Truck Log build assets do not copy favicon.ico.');
must(hasAssetCoverage(assets, 'apps/truck-log/src/assets/branding/dana-favicon.png'),
  'Truck Log build assets do not copy the Dana branding assets directory.');

console.log('[PASS] Truck Log exact Dana Diamond favicon contract passed.');
