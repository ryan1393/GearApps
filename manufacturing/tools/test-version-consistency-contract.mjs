import {
  contractPath,
  manufacturingRoot,
  workspaceRoot,
} from './lib/contract-paths.mjs';
// One version everywhere: package.json, the shared constant, compose image tags,
// the README heading, and the UI footers/API that read the constant.
import fs from 'node:fs';
import path from 'node:path';

const root = manufacturingRoot;
const read = (p) => fs.readFileSync(contractPath(root, p), 'utf8');
const fail = (m) => {
  throw new Error(m);
};

const version = JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  fail(`package.json version must be x.y.z; found ${version}`);
const lock = JSON.parse(read('package-lock.json'));
if (lock.version !== version || lock.packages?.['']?.version !== version)
  fail('package-lock release versions do not match package.json');
const central = fs.readFileSync(contractPath(process.cwd(), path.join(workspaceRoot, 'libs/shared/domain/src/lib/app-version.ts')), 'utf8');
const constant = /GEAR_APPS_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(central)?.[1];
if (JSON.parse(read('vendor/dana-ui/VENDOR_MANIFEST.json')).danaAppsVersion !== version)
  fail('vendor ownership version does not match package.json');
if (!read('libs/shared/util-constants/src/lib/app-version.constants.ts').includes("from '@gearapps/shared/domain'"))
  fail('Manufacturing release constant must re-export the shared root version');
if (
  !fs
    .readFileSync(contractPath(process.cwd(), path.join(workspaceRoot, 'README.md')), 'utf8')
    .includes(`# GearApps ${version}`)
)
  fail('Root README release differs from root package');
if (constant !== version)
  fail(`GEAR_APPS_VERSION (${constant}) != package.json (${version})`);
const collectorRoot = path.join(workspaceRoot, 'apps/lapper-read');
const collectorProperties = fs.readFileSync(
  contractPath(process.cwd(), path.join(collectorRoot, 'Directory.Build.props')),
  'utf8',
);
if (
  /<Version>\s*([^<]+?)\s*<\/Version>/.exec(collectorProperties)?.[1] !==
  version
)
  fail('Lapper Read collector release version differs from root');
for (const project of ['LapperRead', 'LapperReadLibrary', 'LapperRead.Tests']) {
  const metadata = fs.readFileSync(
    contractPath(process.cwd(), path.join(collectorRoot, project, project + '.csproj')),
    'utf8',
  );
  if (
    /<(?:Version|VersionPrefix|AssemblyVersion|FileVersion|InformationalVersion)>/.test(
      metadata,
    )
  )
    fail(`${project} must inherit the shared collector release version`);
}

const pythonCollector = fs.readFileSync(
  contractPath(process.cwd(), path.join(workspaceRoot, 'apps/lapper-read-py/lapper_read/__init__.py')),
  'utf8',
);
if (/__version__\s*=\s*"([^"]+)"/.exec(pythonCollector)?.[1] !== version)
  fail('Python Lapper Read collector version differs from root');

const tags = [
  ...read('compose.yml').matchAll(/image: (dana-apps-[a-z-]+):(\S+)/g),
];
const expectedImages = ['gear-app-server','lapper-client','blade-tracking','cutter-builder','greenshed','lapper-read'];
if (tags.length !== expectedImages.length || expectedImages.some(name => !tags.some(([,image]) => image === 'dana-apps-' + name)))
  fail(`compose.yml should tag all ${expectedImages.length} Gear images; found ${tags.length}`);
for (const [, image, tag] of tags)
  if (tag !== version) fail(`compose.yml ${image}:${tag} != ${version}`);

if (!read('README.md').includes(`# Gear Apps ${version}`))
  fail(`README.md heading must read "# Gear Apps ${version}"`);

for (const nav of [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component',
]) {
  if (!read(nav + '.html').includes('v{{ appVersion }}'))
    fail(`${nav}.html must show the shared version`);
  if (!read(nav + '.ts').includes('appVersion = GEAR_APPS_VERSION'))
    fail(`${nav}.ts must use GEAR_APPS_VERSION`);
}
if (
  !read('apps/server/src/swagger.ts').includes('.setVersion(GEAR_APPS_VERSION)')
)
  fail('Swagger must report GEAR_APPS_VERSION');
if (
  !read(
    'libs/server/feat-health/src/lib/server-feature-health.controller.ts',
  ).includes('version: GEAR_APPS_VERSION')
)
  fail('health/live must report GEAR_APPS_VERSION');

console.log(
  `[PASS] Version ${version} is consistent across package.json, constant, compose images, README, UI and API.`,
);

for (const file of ['package.json', 'package-lock.json', 'nx.json'])
  if (fs.existsSync(path.join(root, file)))
    fail(`Detached manufacturing workspace file remains: ${file}`);
