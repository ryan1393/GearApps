import fs from 'node:fs';

const navs = [
  { file: 'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.html', route: '/blades', label: 'Blade Dashboard', brand: 'BLADE TRACKING' },
  { file: 'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.html', route: '/cutter-builder', label: 'Cutter Dashboard', brand: 'CUTTER BUILDER' },
  { file: 'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.html', route: '/greenshed', label: 'Greenshed Dashboard', brand: 'GREENSHED' },
];

for (const nav of navs) {
  const html = fs.readFileSync(nav.file, 'utf8');
  if (!html.includes(`<strong>${nav.brand}</strong>`)) throw new Error(`${nav.file} brand must retain ${nav.brand}.`);
  if (!html.includes(`<span>${nav.label}</span><span class="nav-current">ACTIVE</span>`)) {
    throw new Error(`${nav.file} must expose a single Truck-Log-style combined dashboard row: ${nav.label}.`);
  }
  if (html.includes('<div class="nav-heading">WORKSPACE</div>')) throw new Error(`${nav.file} must not contain a redundant WORKSPACE heading.`);
  const exactDashboardLink = new RegExp(`routerLink=\"${nav.route.replaceAll('/', '\\/')}\"[^>]*class=\"side-link primary\"`, 'g');
  const matches = html.match(exactDashboardLink) || [];
  if (matches.length !== 1) throw new Error(`${nav.file} must have exactly one primary app dashboard link; found ${matches.length}.`);
}

console.log('[PASS] Sidebar navigation hierarchy contract passed: app identity lives in the brand and each app exposes one combined dashboard row with no redundant WORKSPACE/app row.');
