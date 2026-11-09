// One version everywhere: package.json, the shared constant, compose image tags,
// the README heading, and the UI footers/API that read the constant.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (m) => { throw new Error(m); };

const version = JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`package.json version must be x.y.z; found ${version}`);
const lock = JSON.parse(read('package-lock.json'));
if (lock.version !== version || lock.packages?.['']?.version !== version) fail('package-lock release versions do not match package.json');
if (JSON.parse(read('vendor/dana-ui/VENDOR_MANIFEST.json')).danaAppsVersion !== version) fail('vendor ownership version does not match package.json');

const constant = /GEAR_APPS_VERSION = '([^']+)'/.exec(read('libs/shared/util-constants/src/lib/app-version.constants.ts'))?.[1];
if (constant !== version) fail(`GEAR_APPS_VERSION (${constant}) != package.json (${version})`);

const tags = [...read('compose.yml').matchAll(/image: (dana-apps-[a-z-]+):(\S+)/g)];
if (tags.length !== 4) fail(`compose.yml should tag 4 Gear images; found ${tags.length}`);
for (const [, image, tag] of tags) if (tag !== version) fail(`compose.yml ${image}:${tag} != ${version}`);

if (!read('README.md').includes(`# Gear Apps ${version}`)) fail(`README.md heading must read "# Gear Apps ${version}"`);

for (const nav of [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component',
]) {
  if (!read(nav + '.html').includes('v{{ appVersion }}')) fail(`${nav}.html must show the shared version`);
  if (!read(nav + '.ts').includes('appVersion = GEAR_APPS_VERSION')) fail(`${nav}.ts must use GEAR_APPS_VERSION`);
}
if (!read('apps/server/src/swagger.ts').includes('.setVersion(GEAR_APPS_VERSION)')) fail('Swagger must report GEAR_APPS_VERSION');
if (!read('libs/server/feat-health/src/lib/server-feature-health.controller.ts').includes('version: GEAR_APPS_VERSION')) fail('health/live must report GEAR_APPS_VERSION');

console.log(`[PASS] Version ${version} is consistent across package.json, constant, compose images, README, UI and API.`);
