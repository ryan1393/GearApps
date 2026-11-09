// The Docker builds install @dana/ui from vendor/ with `npm ci`; a stale lockfile hash breaks that build.
import crypto from 'node:crypto';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const spec = pkg.devDependencies?.['@dana/ui'] ?? pkg.dependencies?.['@dana/ui'];
const fail = (msg) => { throw new Error(`[FAIL] ${msg}`); };

if (!spec?.startsWith('file:vendor/dana-ui/')) fail(`@dana/ui must come from vendor/dana-ui (found ${spec})`);
const tgz = spec.slice('file:'.length);
if (!fs.existsSync(tgz)) fail(`${tgz} is missing`);
const entry = lock.packages?.['node_modules/@dana/ui'];
if (!entry) fail('package-lock.json has no @dana/ui entry');
if (entry.resolved !== spec) fail(`package-lock.json resolves @dana/ui to ${entry.resolved}, expected ${spec}`);
const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
if (entry.integrity !== integrity) fail(`package-lock.json hash for ${tgz} is stale; run npm install after re-vendoring Dana UI`);
for (const file of ['docker/truck-log/web.Dockerfile', 'docker/truck-log/server.Dockerfile']) {
  const text = fs.readFileSync(file, 'utf8');
  const copies = text.split('COPY vendor ./vendor').length - 1;
  const installs = text.split('RUN npm ci').length - 1;
  if (copies < installs) fail(`${file} runs npm ci without copying vendor/ first`);
}
if (!fs.readFileSync('.dockerignore', 'utf8').includes('!vendor/dana-ui/*.tgz')) fail('.dockerignore excludes the vendored Dana UI package');
console.log(`[PASS] Vendored Dana UI ${entry.version} matches package-lock.json and reaches the Docker builds.`);
