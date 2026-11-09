import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const must = (ok, message) => { if (!ok) throw new Error(message); };
const canonicalRecord = (value) => Object.fromEntries(
  Object.entries(value ?? {}).sort(([a],[b]) => a.localeCompare(b))
);

const pkg = json('package.json');
must(pkg.name === '@dana-apps/source', 'Root package must identify the Dana Apps monorepo.');
must(pkg.packageManager === 'npm@11.6.2', 'Root packageManager must align with the Docker npm 11.6.2 toolchain.');
must(pkg.scripts?.['build:gear-app-server'] === 'nx build gear-app-server', 'gear-app-server build script missing.');
must(!pkg.scripts?.['build:server'], 'Legacy build:server script must be removed.');
must(pkg.scripts?.['docker:up'] === 'docker compose -f compose.yml up -d --build', 'docker:up must use modern docker compose + compose.yml.');
must(pkg.scripts?.['docker:down'] === 'docker compose -f compose.yml down', 'docker:down must use modern docker compose + compose.yml.');
must(pkg.scripts?.['docker:logs'] === 'docker compose -f compose.yml logs -f', 'docker:logs must use modern docker compose + compose.yml.');
must(pkg.scripts?.['docker:config'] === 'docker compose -f compose.yml config', 'docker:config must validate compose.yml.');
must(pkg.scripts?.['docker:build'] === 'docker compose -f compose.yml build --progress=plain', 'docker:build must use modern docker compose.');
must(!JSON.stringify(pkg).includes('gear-app-gear-app-server'), 'Root package contains a double-renamed Gear API target.');
const lock = json('package-lock.json');
must(lock.name === '@dana-apps/source', 'package-lock root name must identify Dana Apps.');
must((lock.packages?.['']?.name) === '@dana-apps/source', 'package-lock root package entry must identify Dana Apps.');
must(JSON.stringify(canonicalRecord(pkg.dependencies)) === JSON.stringify(canonicalRecord(lock.packages?.['']?.dependencies)), 'package-lock root dependencies do not match package.json.');
must(JSON.stringify(canonicalRecord(pkg.devDependencies)) === JSON.stringify(canonicalRecord(lock.packages?.['']?.devDependencies)), 'package-lock root devDependencies do not match package.json.');

must(pkg.devDependencies?.['@dana/ui'] === 'file:vendor/dana-ui/package', 'Dana Apps must consume @dana/ui from the self-contained vendored package.');
must(lock.packages?.['']?.devDependencies?.['@dana/ui'] === 'file:vendor/dana-ui/package', 'package-lock root must pin the vendored @dana/ui dependency.');
const vendoredDanaUiPackage = json('vendor/dana-ui/package/package.json');
must(vendoredDanaUiPackage.name === '@dana/ui', 'Vendored Dana UI package.json must identify @dana/ui.');
must(vendoredDanaUiPackage.version === json('vendor/dana-ui/VENDOR_MANIFEST.json').packageVersion, 'Vendored Dana UI version must match the vendor manifest.');
must(fs.existsSync(path.join(root, 'node_modules/@dana/ui/package.json')), 'Installed node_modules/@dana/ui package is missing.');
const installedDanaUiPackage = json('node_modules/@dana/ui/package.json');
must(installedDanaUiPackage.name === '@dana/ui', 'Installed Dana UI package must identify @dana/ui.');
must(installedDanaUiPackage.version === vendoredDanaUiPackage.version, 'Installed Dana UI package version must match the vendored package.');
const installedDanaUiRealPath = fs.realpathSync(path.join(root, 'node_modules/@dana/ui'));
const vendoredDanaUiRealPath = fs.realpathSync(path.join(root, 'vendor/dana-ui/package'));
must(
  path.resolve(installedDanaUiRealPath) === path.resolve(vendoredDanaUiRealPath),
  'Installed @dana/ui must resolve to the vendored package. Installed=' + installedDanaUiRealPath + '; vendor=' + vendoredDanaUiRealPath
);
must(fs.existsSync(path.join(root, 'vendor/dana-ui/package/styles/dana-ui.css')), 'Vendored Dana UI canonical stylesheet is missing.');
must(fs.existsSync(path.join(root, 'vendor/dana-ui/package/styles/dana-core.css')), 'Vendored Dana UI core stylesheet is missing.');
for (const projectRel of ['apps/blade-tracking/project.json','apps/cutter-builder/project.json','apps/greenshed/project.json']) {
  const project = json(projectRel);
  const styles = project.targets?.build?.options?.styles ?? [];
  const external = 'node_modules/@dana/ui/styles/dana-ui.css';
  const bridge = 'node_modules/@dana/ui/styles/gear-compat-overrides.css';
  must(styles.includes(external), `${projectRel} must load the Truck Log-derived external Dana UI stylesheet.`);
  must(styles.includes(bridge), `${projectRel} must load the Dana UI migration bridge.`);
  must(styles.indexOf(bridge) === styles.indexOf(external) + 1, `${projectRel} must load the migration bridge immediately after external Dana UI.`);
}
for (const dockerfile of ['apps/blade-tracking/Dockerfile','apps/cutter-builder/Dockerfile','apps/greenshed/Dockerfile','apps/server/Dockerfile']) {
  must(read(dockerfile).includes('COPY vendor/dana-ui/package ./vendor/dana-ui/package'), `${dockerfile} must copy vendored @dana/ui before npm install.`);
}


must(fs.existsSync(path.join(root, 'apps/server/project.json')), 'Physical apps/server source folder must remain present.');
must(fs.existsSync(path.join(root, 'libs/server/data-access/project.json')), 'Physical libs/server backend library root must remain present.');
must(!fs.existsSync(path.join(root, 'libs/gear-app-server')), 'V19 must not create a physical libs/gear-app-server directory.');
must(!fs.existsSync(path.join(root, 'apps/gear-app-server')), 'V19 must not physically rename apps/server on Windows.');
const serverProject = json('apps/server/project.json');
must(serverProject.name === 'gear-app-server', 'Gear API Nx project name is wrong.');
must(serverProject.sourceRoot === 'apps/server/src', 'Gear API sourceRoot must remain apps/server/src.');
must((serverProject.tags || []).includes('domain:gear-apps'), 'Gear API must carry domain:gear-apps.');
must(serverProject.targets?.serve?.options?.buildTarget === 'gear-app-server:build', 'Gear API serve target must build gear-app-server.');
must(serverProject.targets?.serve?.configurations?.development?.buildTarget === 'gear-app-server:build:development', 'Gear API development serve target must use gear-app-server.');
must(serverProject.targets?.serve?.configurations?.production?.buildTarget === 'gear-app-server:build:production', 'Gear API production serve target must use gear-app-server.');
must(!JSON.stringify(serverProject).includes('gear-app-gear-app-server'), 'Gear API project contains a double-renamed build target.');
for (const rel of ['apps/server/project.json','apps/server-e2e/project.json','package.json','tools/start-gear-apps.ps1','tools/validate-gear-apps.ps1']) {
  if (fs.existsSync(path.join(root, rel))) must(!read(rel).includes('gear-app-gear-app-server'), `${rel} contains a double-renamed Gear API target.`);
}


if (fs.existsSync(path.join(root, 'apps/server-e2e/project.json'))) {
  const e2eProject = json('apps/server-e2e/project.json');
  must(e2eProject.name === 'gear-app-server-e2e', 'Gear API e2e Nx project name is wrong.');
  must((e2eProject.implicitDependencies || []).includes('gear-app-server'), 'Gear API e2e project must depend on gear-app-server.');
  must(!fs.existsSync(path.join(root, 'apps/gear-app-server-e2e')), 'V19 must not physically rename apps/server-e2e on Windows.');
}
const compose = read('compose.yml');
must(!fs.existsSync(path.join(root, 'docker-compose.yml')), 'Legacy docker-compose.yml must be removed; compose.yml is authoritative.');
for (const marker of ['name: dana-apps', 'dana-postgres:', 'gear-db-bootstrap:', 'gear-base-data-bootstrap:', 'gear-app-server:', 'DATABASE_SYNCHRONIZE: \"false\"', 'DANA_FRESH_DB_BOOTSTRAP: \"YES\"', 'service_completed_successfully', 'health/ready', 'name: ${DANA_POSTGRES_VOLUME_NAME:-dana-apps-gear-postgres}']) {
  must(compose.includes(marker), `Compose missing ${marker}`);
}
must(!compose.includes('external:'), 'Fresh-host Compose must create/reuse its named Gear volume instead of requiring an external volume.');
must(!/container_name\s*:/.test(compose), 'Compose must not use explicit container_name values.');
must(!/^\s{2}server:/m.test(compose), 'Legacy server Compose service remains.');

const example = read('.env.example');
must(/^DATABASE_SYNCHRONIZE=false$/m.test(example), '.env.example must disable TypeORM synchronize.');
for (const key of ['DANA_POSTGRES_VOLUME_NAME', 'GEAR_DB_NAME', 'GEAR_DB_USERNAME', 'GEAR_DB_PASSWORD', 'GEAR_API_PORT']) {
  must(new RegExp(`^${key}=`, 'm').test(example), `Missing namespaced env ${key}`);
}
must(/^DANA_POSTGRES_VOLUME_NAME=dana-apps-gear-postgres$/m.test(example), '.env.example must provide the fresh-host Gear volume default.');
must(/^SEED_ADMIN_PASSWORD=replace-with-strong-admin-password$/m.test(example), '.env.example must require a fresh-host admin seed password.');
must(/^SEED_USER_PASSWORD=replace-with-strong-user-password$/m.test(example), '.env.example must require a fresh-host user seed password.');
const schema = read('libs/server/util-common/src/lib/config/schema.ts');
must(schema.includes('[ENV_DATABASE_SYNCHRONIZE]: Joi.boolean().default(false)'), 'Joi synchronize default must be false.');

const eslint = json('.eslintrc.json');
const eslintText = JSON.stringify(eslint);
for (const tag of ['domain:gear-apps', 'domain:truck-log', 'domain:shared']) {
  must(eslintText.includes(tag), `Missing Nx boundary ${tag}`);
}


const sharedConfig = json('libs/shared/dana-app-config/project.json');
must((sharedConfig.tags || []).includes('domain:shared'), 'Dana app config must be domain:shared.');
const frontendUtil = json('libs/frontend/util-common/project.json');
must((frontendUtil.tags || []).includes('domain:shared'), 'frontend-util-common must be domain:shared so Dana Apps products can reuse toast/dialog primitives.');
for (const gearSharedRel of ['libs/shared/util-constants/project.json', 'libs/shared/util-types/project.json']) {
  must((json(gearSharedRel).tags || []).includes('domain:gear-apps'), `${gearSharedRel} contains Gear domain rules/types and must not be globally shared.`);
}
const links = read('libs/shared/dana-app-config/src/lib/dana-app-links.ts');
for (const marker of ['bladeTracking: 4200', 'cutterBuilder: 4201', 'greenshed: 4202', 'truckLog: 4300']) {
  must(links.includes(marker), `Shared app registry missing ${marker}`);
}
const utilConstantsIndex = read('libs/shared/util-constants/src/index.ts');
must(!utilConstantsIndex.includes('dana-app-links'), 'Gear-only util-constants barrel still exports the retired Dana app-links module; cross-app URLs belong in @libs/shared/dana-app-config.');
for (const nav of [
  'apps/blade-tracking/src/app/layout/app-nav/app-nav.component.ts',
  'apps/cutter-builder/src/app/layout/cutter-builder-nav/cutter-builder-nav.component.ts',
  'apps/greenshed/src/app/layout/greenshed-nav/greenshed-nav.component.ts',
]) {
  const navText = read(nav);
  const canonicalDanaImport = "import { getDanaAppUrl } from '@libs/shared/dana-app-config';";
  const danaImportCount = navText.split(canonicalDanaImport).length - 1;
  must(danaImportCount === 1, `${nav} must contain exactly one canonical getDanaAppUrl import; found ${danaImportCount}.`);
  must(!/import\s*\{[^}]*getDanaAppUrl[^}]*\}\s*from\s*'@libs\/shared\/util-constants';/.test(navText), `${nav} must not import getDanaAppUrl from Gear-only util-constants.`);
}

const login = read('libs/frontend/feature-login/src/lib/frontend-feature-login/frontend-feature-login.component.ts');
must(!login.includes('GearApps-E2E-Only-2026!') && !login.includes('GearApps-Admin-Only-2026!'), 'Frontend bundle still contains test passwords.');
const loginSwaggerContract = read('tools/test-login-swagger-ui-contract.mjs');
must(loginSwaggerContract.includes("apps/server/src/swagger.ts"), 'Login/Swagger contract must read Swagger from physical apps/server.');
must(!/apps[\\/]+gear-app-server/.test(loginSwaggerContract), 'Login/Swagger contract still uses logical gear-app-server as a physical filesystem path.');

const health = read('libs/server/feat-health/src/lib/server-feature-health.controller.ts');
must(health.includes("@Get('live')") && health.includes("@Get('ready')"), 'Gear API must expose live + ready health endpoints.');
const users = read('libs/server/feat-user/src/lib/server-feat-user.service.ts');
must(users.includes('PUBLIC_API_BASE_URL') && !users.includes('verificationLink: `http://localhost:3333'), 'User email links must use configured public API URL.');

const nx = json('nx.json');
must(!nx.nxCloudAccessToken, 'Stale Nx Cloud access token must be removed.');
must(nx.analytics === false, 'Nx analytics must be explicitly false for the clean baseline.');


const setup = read('tools/setup-gear-apps.ps1');
must(setup.includes("'gear-app-server',") && setup.includes("'blade-tracking',"), 'Normal Gear Apps setup must require gear-app-server.');
const requiredProjectsBlock = setup.match(/\$requiredProjects\s*=\s*@\([\s\S]*?\)/)?.[0] ?? '';
must(requiredProjectsBlock.includes("'gear-app-server',"), 'Normal Gear Apps setup required-project list is missing gear-app-server.');
must(!requiredProjectsBlock.includes("'server',"), 'Normal Gear Apps setup still requires legacy server project.');

const restoreBase = read('tools/base-data/restore-legacy-base-data.ps1');
must(restoreBase.includes('[string]$PgContainer = "dana-postgres"'), 'Base-data restore must target dana-postgres by default.');
must(restoreBase.includes("docker compose -f (Join-Path $ProjectRoot 'compose.yml') exec -T $PgContainer"), 'Base-data restore must use modern Compose service exec.');
must(!restoreBase.includes('& docker exec $PgContainer'), 'Base-data restore still depends on an explicit container name.');

must(fs.existsSync(path.join(root, 'commands/SETUP-GEAR-APPS.cmd')), 'Root setup wrapper must exist after hardening.');
const startScript = read('tools/start-gear-apps.ps1');
must(startScript.includes('nx serve gear-app-server') && !/nx serve server(?:\s|['"]|$)/.test(startScript), 'Start script must launch gear-app-server only.');
const validateScript = read('tools/validate-gear-apps.ps1');
must(validateScript.includes('nx build gear-app-server') && !/nx build server(?:\s|['"]|$)/.test(validateScript), 'Validation script must build gear-app-server only.');
for (const nginx of ['apps/blade-tracking/nginx.conf','apps/cutter-builder/nginx.conf','apps/greenshed/nginx.conf']) {
  const text = read(nginx);
  must(text.includes('http://gear-app-server:3333') && !text.includes('http://server:3333'), `${nginx} must proxy to gear-app-server.`);
}
const apiDockerfile = read('apps/server/Dockerfile');
must(apiDockerfile.includes('nx build gear-app-server'), 'Gear API Dockerfile must build the gear-app-server Nx project.');
must(apiDockerfile.includes('dist/apps/server'), 'Gear API Dockerfile must preserve the physical dist/apps/server output path.');
must(compose.includes('dockerfile: apps/server/Dockerfile'), 'Compose must use the stable physical apps/server Dockerfile path.');
must(fs.existsSync(path.join(root, 'apps/server/src/fresh-db-bootstrap.ts')), 'Fresh-host database bootstrap source is missing.');
must(serverProject.targets?.['build-fresh-db-bootstrap']?.options?.main === 'apps/server/src/fresh-db-bootstrap.ts', 'Gear server project must build the one-shot fresh DB bootstrap.');
const freshBootstrap = read('apps/server/src/fresh-db-bootstrap.ts');
for (const marker of ['DANA_FRESH_DB_BOOTSTRAP', "process.env['DATABASE_SYNCHRONIZE'] = 'true'", "process.env['DATABASE_SYNCHRONIZE'] = 'false'", 'partial schema', 'UserDatabaseSeedService']) must(freshBootstrap.includes(marker), `Fresh DB bootstrap missing ${marker}`);
must(fs.existsSync(path.join(root, 'DANA-APPS-FRESH-DOCKER-UP.sh')), 'Fresh Docker host helper script is missing.');
if (fs.existsSync(path.join(root, 'tools/api-route-manifest.json'))) {
  const routeManifest = read('tools/api-route-manifest.json');
  must(!routeManifest.includes('apps/gear-app-server/') && !routeManifest.includes('apps\\gear-app-server\\'), 'API route manifest must keep stable physical apps/server paths.');
  must(routeManifest.includes('apps/server/'), 'API route manifest must contain physical apps/server source paths.');
}
const liveEnv = fs.existsSync(path.join(root,'.env')) ? read('.env') : '';
if (liveEnv) {
  must(/^DATABASE_SYNCHRONIZE=false$/m.test(liveEnv), '.env must disable TypeORM synchronize.');
  const volumeMatch = liveEnv.match(/^DANA_POSTGRES_VOLUME_NAME=(.+)$/m);
  if (volumeMatch) must(volumeMatch[1].trim().length >= 4, '.env volume name is truncated.');
}

const dockerIgnore = read('.dockerignore');
for (const marker of ['.angular', '_patch_backups', 'tools/data-import/work']) {
  must(dockerIgnore.includes(marker), `.dockerignore missing ${marker}`);
}

// Final physical-path gate: tests/config/source may refer to the logical project name,
// but they may never use it as an apps/libs filesystem directory.
{
  const skip = new Set(['node_modules','dist','.angular','.nx','_patch_backups','coverage','.git']);
  const bad = [];
  const exts = new Set(['.json','.ts','.tsx','.js','.jsx','.mjs','.cjs','.ps1','.cmd','.yml','.yaml','.conf','.html','.scss','.css','.env','.example','.xml','.sh']);
  function walkPhysical(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const full=path.join(dir,entry.name);
      const rel=path.relative(root,full).replaceAll('\\','/');
      if (entry.isDirectory()) { if (!skip.has(entry.name)) walkPhysical(full); continue; }
      if (!entry.isFile() || rel === 'tools/test-dana-apps-premerge-contract.mjs') continue;
      if (!(rel.startsWith('apps/') || rel.startsWith('libs/') || rel.startsWith('tools/') || !rel.includes('/'))) continue;
      if (!(exts.has(path.extname(entry.name).toLowerCase()) || entry.name === 'Dockerfile' || entry.name.startsWith('.env'))) continue;
      let text; try { text=fs.readFileSync(full,'utf8'); } catch { continue; }
      if (/(?:apps|libs)[\\/]+gear-app-server(?:-e2e)?(?:[\\/]|['"`]|$)/.test(text) || /dist[\\/]+apps[\\/]+gear-app-server(?:[\\/]|['"`]|$)/.test(text)) bad.push(rel);
    }
  }
  walkPhysical(root);
  must(bad.length === 0, `Operational files still contain logical Gear API name as a physical apps/libs path: ${bad.join(', ')}`);
}

console.log('[PASS] Dana Apps pre-merge hardening contract passed.');

