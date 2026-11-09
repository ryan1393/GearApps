import { contractPath } from './lib/contract-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(contractPath(root, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

const compose = read('compose.yml');
const serverProject = json('apps/server/project.json');
const dockerfile = read('apps/server/Dockerfile');
const bootstrap = read('apps/server/src/fresh-db-bootstrap.ts');
const env = read('.env.example');
const helper = read('DANA-APPS-FRESH-DOCKER-UP.sh');
const pkg = json('package.json');
const doc = read('DANA_APPS_FRESH_DOCKER.md');
const transfer = read('TRANSFER-DANA-APPS-TO-DOCKER.cmd');

must(!fs.existsSync(contractPath(root, 'docker-compose.yml')), 'compose.yml must be the only authoritative root Compose file.');
must(compose.includes('name: dana-apps'), 'Compose project name must be dana-apps.');
for (const service of ['dana-postgres:', 'gear-db-bootstrap:', 'gear-base-data-bootstrap:', 'gear-app-server:', 'blade-tracking:', 'cutter-builder:', 'greenshed:']) {
  must(compose.includes(service), `Fresh-host Compose missing ${service}`);
}
must(!compose.includes('external:'), 'Fresh-host Gear volume must not require a pre-existing external Docker volume.');
must(compose.includes('name: ${DANA_POSTGRES_VOLUME_NAME:-dana-apps-gear-postgres}'), 'Fresh-host Gear volume must have a stable default name.');
must(compose.includes('condition: service_completed_successfully'), 'Runtime API must wait for one-shot DB/bootstrap jobs.');
must(compose.includes('DANA_FRESH_DB_BOOTSTRAP: "YES"'), 'Fresh DB bootstrap guard is missing.');
must(compose.includes('SEED_ADMIN_PASSWORD: ${SEED_ADMIN_PASSWORD:?'), 'Fresh host must require an admin seed password.');
must(compose.includes('command: ["node", "dist/manufacturing/apps/server-bootstrap/main.js"]'), 'Fresh schema bootstrap command is missing.');
must(compose.includes('command: ["node", "manufacturing/tools/base-data/import-base-data.mjs", "--bootstrap-only"]'), 'Fresh base-data bootstrap command is missing.');
must(compose.indexOf('gear-db-bootstrap:') < compose.indexOf('gear-base-data-bootstrap:'), 'Schema bootstrap must be defined before base-data bootstrap.');

must(serverProject.targets?.['build-fresh-db-bootstrap']?.options?.command.includes('webpack.bootstrap.config.js'), 'Gear server project must build the bootstrap using the native root webpack plugin.');
const webpackBootstrap=read('apps/server/webpack.bootstrap.config.js');
must(webpackBootstrap.includes("main: './src/fresh-db-bootstrap.ts'") && webpackBootstrap.includes('NxAppWebpackPlugin'), 'Native bootstrap config must preserve its actual main source');
for (const marker of [
  'build-fresh-db-bootstrap',
  'dist/manufacturing/apps/server-bootstrap',
  'tools/base-data',
]) {
  must(dockerfile.includes(marker), `Server Dockerfile missing ${marker}`);
}

for (const marker of [
  'DANA_FRESH_DB_BOOTSTRAP',
  "process.env['DATABASE_SYNCHRONIZE'] = 'true'",
  "process.env['DATABASE_SYNCHRONIZE'] = 'false'",
  'information_schema.tables',
  'Refusing automatic synchronize against a partial schema',
  'UserDatabaseSeedService',
  'missingAfterBootstrap',
  'database bootstrap completed and verified',
]) {
  must(bootstrap.includes(marker), `Fresh DB bootstrap missing ${marker}`);
}

for (const line of [
  'SEED_ADMIN_PASSWORD=replace-with-strong-admin-password',
  'SEED_USER_PASSWORD=replace-with-strong-user-password',
  'DANA_POSTGRES_VOLUME_NAME=dana-apps-gear-postgres',
  'DATABASE_SYNCHRONIZE=false',
]) {
  must(env.includes(line), `.env.example missing ${line}`);
}

for (const command of [
  'docker compose -f compose.yml config',
  'docker compose -f compose.yml build --progress=plain',
  'docker compose -f compose.yml up -d',
  'docker compose -f compose.yml ps',
]) {
  must(helper.includes(command.replace('docker compose -f compose.yml', 'docker compose --env-file "$ENV_FILE" -f manufacturing/compose.yml')), `Fresh Docker helper missing ${command}`);
}

for (const marker of [
  'require_secret GEAR_DB_PASSWORD 12',
  'require_secret SEED_ADMIN_PASSWORD 12',
  'require_secret SEED_USER_PASSWORD 12',
  'require_secret JWT_ACCESS_SECRET 16',
  'require_secret JWT_REFRESH_SECRET 16',
  'still contains a placeholder value',
  'docker volume inspect',
  'It will NOT be deleted',
  'gear-base-data-bootstrap',
]) {
  must(helper.includes(marker), `Fresh Docker helper missing safety marker ${marker}`);
}

const commands=JSON.parse(fs.readFileSync(contractPath(root,'../tools/manufacturing-scripts.json'),'utf8'));
must(commands['docker:up']?.includes('docker compose') && commands['docker:up']?.includes('up -d --build'), 'docker:up must use modern Compose with a build');
must(commands['docker:config']?.includes('docker compose') && commands['docker:config']?.includes('config'), 'docker:config must validate Compose');

for (const marker of [
  'Dana Apps — Fresh Docker Host',
  'DATABASE_SYNCHRONIZE=false',
  'admin@example.com',
  'DANA-APPS-FRESH-DOCKER-UP.sh',
  'dana-apps-gear-postgres',
]) {
  must(doc.includes(marker), `Fresh Docker documentation missing ${marker}`);
}

for (const marker of [
  'usftwvmdocker',
  '/tmp/dana-apps.v0.1',
  'scp.exe -C',
  'tar.exe -czf',
]) {
  must(transfer.includes(marker), `Dana Apps transfer helper missing ${marker}`);
}

console.log('[PASS] Dana Apps fresh Docker host contract: self-created Gear volume, guarded one-shot schema/user bootstrap, idempotent base-data import, runtime synchronize=false, modern compose.yml, and health sequencing are enforced.');
