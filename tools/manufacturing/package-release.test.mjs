import test from 'node:test';
import assert from 'node:assert/strict';
import { packageFileAllowed } from '../../tools/package-release.mjs';

const allowed = (paths) => {
  for (const file of paths) assert.equal(packageFileAllowed(file), true, file);
};
const blocked = (paths) => {
  for (const file of paths) assert.equal(packageFileAllowed(file), false, file);
};

test('release keeps all applications, root dependency authority and shared UI', () => {
  allowed([
    'package.json',
    'package-lock.json',
    'nx.json',
    'tsconfig.base.json',
    'apps/lapper-client/src/main.ts',
    'apps/lapper-read/Directory.Build.props',
    'apps/lapper-read/project.json',
    'apps/lapper-read/LapperRead/LapperRead.csproj',
    'apps/lapper-read/LapperReadLibrary/LapperReadLibrary.csproj',
    'apps/blade-tracking/project.json',
    'apps/cutter-builder/project.json',
    'apps/greenshed/project.json',
    'apps/server/src/main.ts',
    'apps/server/src/bootstrap-database.ts',
    'libs/shared/dana-ui/src/index.ts',
    'libs/shared/dana-ui/src/styles/gear-apps.css',
  ]);
});

test('nested build pages survive generated-output exclusions', () => {
  allowed([
    'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.ts',
    'libs/manufacturing/frontend/feature-cutter-builder/src/lib/pages/build/cutter-build.component.html',
  ]);
  blocked([
    'node_modules/typescript/lib/typescript.js',
    'manufacturing/node_modules/a/index.js',
    'dist/apps/server/main.js',
    'manufacturing/dist/apps/server/main.js',
    '.nx/workspace-data/project-graph.json',
    'manufacturing/.angular/cache/file',
    '.git/config',
    'coverage/report.html',
    'releases/GearApps-70.3.0.zip',
    'tools/database/cleanup.sql',
    'tools/database/legacy-import.sql',
  ]);
});

test('only documented environment templates enter a release', () => {
  allowed([
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.example',
    '.env.postgres.example',
  ]);
  blocked([
    '.env',
    '.env.local',
    '.env.production',
    'manufacturing/.ENV',
    '.npmrc',
    'manufacturing/.npmrc',
  ]);
});

test('private credentials and signing material stay out of source releases', () => {
  blocked([
    'id_rsa',
    'id_ed25519',
    'id_ecdsa.pub',
    'config/client.pem',
    'config/private.key',
    'config/certificate.pfx',
    'config/certificate.p12',
    'config/keys.jks',
    'config/client.keystore',
    'config/passwords.kdbx',
    'credentials.json',
    'service-account-production.json',
    'secret-settings.json',
    'secrets/readme.txt',
    'config/credentials/token.txt',
  ]);
});

test('browser sessions and runtime data are excluded at any depth', () => {
  blocked([
    'storage-state.json',
    'auth-state-admin.json',
    'rxo-browser-state.json',
    'cookies.json',
    'tests/cookies-admin.json',
    'runtime-data/database.sqlite',
    'manufacturing/runtime-data/session.txt',
    'manufacturing/database.db',
    'manufacturing/database.sqlite3',
    'tools/database/backups/GearApps-before-cleanup.dump',
    'backups/gearapps.sql',
    'manufacturing/database.dump',
    'manufacturing/database.bak',
    'database-reports/private-audit.json',
    'server.log',
    'test-results/report.json',
  ]);
});

test('archived sources and import scratch data do not enter the current release', () => {
  blocked([
    'source-archives/GearApps-70.2.0.zip',
    '_archive/old-source.ts',
    'manufacturing/_archive/old-source.ts',
    '_patch_backups/service.ts',
    'tools/manufacturing/data-import/work/cache.json',
    'manufacturing/archive.tgz',
  ]);
});

test('archive entries cannot be absolute or traverse outside the workspace', () => {
  blocked([
    '',
    '/etc/passwd',
    '../package.json',
    'a/../../package.json',
    './package.json',
    'a/./file.ts',
    'a//file.ts',
    'a\\..\\file.ts',
    'C:\\package.json',
  ]);
});

test('collector source is preserved while .NET outputs and local state are excluded', () => {
  allowed([
    'apps/lapper-read/Directory.Build.props',
    'apps/lapper-read/LapperRead/Program.cs',
    'apps/lapper-read/LapperRead.Tests/ApiTests.cs',
    'apps/lapper-read/LapperReadLibrary/BusinessLogic/Fanuc.cs',
  ]);
  blocked([
    'apps/lapper-read/LapperRead/bin/Release/net8.0/LapperRead.dll',
    'apps/lapper-read/LapperRead/obj/project.assets.json',
    'apps/lapper-read/LapperRead.Tests/TestResults/results.trx',
    'apps/lapper-read/.tools/dotnet/dotnet.exe',
    'apps/lapper-read/.vs/metadata',
    'apps/lapper-read/.nuget/packages/package.dll',
    'apps/lapper-read/state/collector.json',
    'apps/lapper-read/LapperRead/state/checkpoints.json',
  ]);
});
