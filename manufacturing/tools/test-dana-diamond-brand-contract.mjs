import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const navs = [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html',
];

const sharedLogo = 'assets/brand/dana-logo.svg';
const sharedLogoPath = contractPath(root, sharedLogo);
if (!fs.existsSync(contractPath(process.cwd(), sharedLogoPath))) {
  throw new Error(`Shared Dana brand asset is missing: ${sharedLogo}`);
}
const logo = fs.readFileSync(contractPath(process.cwd(), sharedLogoPath), 'utf8');
if (!logo.includes('<svg') || !/DANA/i.test(logo)) {
  throw new Error('Shared Dana brand asset is not a valid Dana SVG.');
}

for (const rel of navs) {
  const text = fs.readFileSync(contractPath(root, rel), 'utf8');
  if (!text.includes('class="brand-mark dana-diamond-mark"')) {
    throw new Error(`${rel} is missing the shared Dana Diamond brand mark.`);
  }
  if (!text.includes('src="assets/brand/dana-logo.svg"')) {
    throw new Error(`${rel} does not use the shared file-backed Dana logo.`);
  }
  if (text.includes('<span class="brand-mark">GA</span>')) {
    throw new Error(`${rel} still contains the old GA placeholder mark.`);
  }
  if (/dana-diamond-word|<polygon class="dana-diamond/.test(text)) {
    throw new Error(`${rel} still embeds an app-local Dana SVG instead of the shared asset.`);
  }
}

for (const rel of [
  'libs/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.html',
  // Running Machines dropped the logo on purpose (DANA-R61R6-LOGO-REMOVED).
]) {
  const text = fs.readFileSync(contractPath(root, rel), 'utf8');
  if (!text.includes('assets/brand/dana-logo.svg')) {
    throw new Error(`${rel} must use the same shared Dana brand asset.`);
  }
}

for (const app of ['blade-tracking', 'cutter-builder', 'greenshed']) {
  const project = JSON.parse(fs.readFileSync(contractPath(root, `apps/${app}/project.json`), 'utf8'));
  const assets = project.targets?.build?.options?.assets ?? [];
  const hasSharedAssets = assets.some(
    (entry) => typeof entry === 'object' && entry.input === 'manufacturing/assets' && entry.output === 'assets' && entry.glob === '**/*',
  );
  if (!hasSharedAssets) {
    throw new Error(`${app}: build assets do not copy the shared root assets folder.`);
  }
}

const oldLocalLogo = contractPath(root, 'apps/greenshed/src/assets/dana-logo.svg');
if (fs.existsSync(contractPath(process.cwd(), oldLocalLogo))) {
  throw new Error('Greenshed still has an app-local Dana logo copy; use assets/brand/dana-logo.svg only.');
}

const brandCss = fs.readFileSync(
  contractPath(root, 'vendor/dana-ui/package/styles/gear-apps/layout/brand.css'),
  'utf8',
);
for (const marker of [
  '.brand-mark.dana-diamond-mark',
  '.dana-diamond-mark img',
  'width: 56px',
  'height: 38px',
]) {
  if (!brandCss.includes(marker)) throw new Error(`brand.css missing Dana brand marker: ${marker}`);
}

const responsiveCss = fs.readFileSync(
  contractPath(root, 'vendor/dana-ui/package/styles/gear-apps/foundation/responsive.css'),
  'utf8',
);
for (const marker of ['width: 64px', 'height: 44px']) {
  if (!responsiveCss.includes(marker)) throw new Error(`Large-screen Dana brand sizing missing: ${marker}`);
}

if (!fs.existsSync(contractPath(root, 'assets/brand/README.md'))) {
  throw new Error('Shared brand upload/replace instructions are missing.');
}

console.log('[PASS] Shared file-backed Dana branding contract passed across all Gear Apps frontends.');
