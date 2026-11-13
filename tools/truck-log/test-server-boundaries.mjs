import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const json = (relative) => JSON.parse(read(relative));
const must = (condition, message) => { if (!condition) throw new Error(message); };

for (const relative of [
  'apps/truck-log-server/project.json',
  'apps/truck-log-server/src/main.ts',
  'apps/truck-log-server/src/app/app.module.ts',
  'apps/truck-log-server/webpack.config.js',
  'libs/truck-log/server/core/project.json',
  'libs/truck-log/server/core/src/index.ts',
  'libs/truck-log/server/core/src/lib/truck-log-server.module.ts',
  'libs/truck-log/server/data-access/project.json',
  'libs/truck-log/server/domain/driver-print/project.json',
  'libs/truck-log/server/domain/rxo/project.json',
  'libs/truck-log/server/infrastructure/uploads/project.json',
  'libs/truck-log/server/infrastructure/sap-documents/project.json',
  'libs/truck-log/server/feature/visits/project.json',
]) must(exists(relative), `Missing server Nx boundary file: ${relative}`);

must(json('apps/truck-log-server/project.json').projectType === 'application', 'truck-log-server must remain a deployable application');
const appDir = path.join(root, 'apps/truck-log-server/src/app');
const entries = fs.readdirSync(appDir, { withFileTypes: true }).map((entry) => entry.name).sort();
must(entries.length === 1 && entries[0] === 'app.module.ts', `Nest application shell must contain only app.module.ts; found ${entries.join(', ')}`);
const composition = read('apps/truck-log-server/src/app/app.module.ts');
must(composition.includes("from '@truck-log/server/core'"), 'Nest app must consume only the server core public API');
for (const concern of ['TypeOrmModule', 'ConfigModule', 'TruckVisitsService', 'ScheduledLoadsService', 'ReferenceDataService', 'DocksService']) {
  must(!composition.includes(concern), `Nest app shell contains implementation concern: ${concern}`);
}

const core = read('libs/truck-log/server/core/src/lib/truck-log-server.module.ts');
for (const alias of [
  '@truck-log/server/auth/access', '@truck-log/server/auth/admin',
  '@truck-log/server/feature/docks', '@truck-log/server/feature/driver-print', '@truck-log/server/feature/health',
  '@truck-log/server/feature/print-agents', '@truck-log/server/feature/reference-data', '@truck-log/server/feature/rxo-documents',
  '@truck-log/server/feature/rxo-expedite', '@truck-log/server/feature/rxo-ingestion', '@truck-log/server/feature/scheduled-loads',
  '@truck-log/server/feature/settings', '@truck-log/server/feature/tv-displays', '@truck-log/server/feature/visits',
]) must(core.includes(alias), `Server core must compose ${alias}`);
for (const envKey of ['TRUCK_LOG_DATABASE_HOST','TRUCK_LOG_DATABASE_PORT','TRUCK_LOG_DATABASE_USERNAME','TRUCK_LOG_DATABASE_PASSWORD','TRUCK_LOG_DATABASE_NAME']) {
  must(core.includes(envKey), `Server core is missing ${envKey}`);
}

const visits = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts');
const visitDto = read('libs/truck-log/server/feature/visits/src/lib/dto/create-truck-visit.dto.ts');
const visitEntity = read('libs/truck-log/server/data-access/src/lib/entities/truck-visit.entity.ts');
for (const source of [visits, visitDto, visitEntity]) {
  must(source.includes('@truck-log/shared/contracts'), 'Visit implementation must reuse the shared contract library');
}
must(visits.includes("from '@truck-log/server/domain/driver-print'"), 'Visits must consume Driver Print through the domain library');
must(visits.includes("from '@truck-log/server/domain/rxo'"), 'Visits must consume RXO SQL/lock rules through the RXO domain library');
const visitsModule = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.module.ts');
must(!visitsModule.includes('ScheduledLoadsModule'), 'Visits must not depend on the Scheduled Loads feature project');
must(visitsModule.includes('DriverPrintDomainModule'), 'Visits must import the Driver Print domain module rather than another feature');

const printAgents = read('libs/truck-log/server/feature/print-agents/src/lib/print-agents.module.ts');
must(printAgents.includes('PrintAgentAuthModule'), 'Print Agents must consume dedicated Print Agent auth boundary');
must(printAgents.includes('DriverPrintDomainModule'), 'Print Agents must consume Driver Print domain boundary');
must(!printAgents.includes('DriverPrintModule'), 'Print Agents must not depend on Driver Print HTTP feature');

const rxoDocuments = read('libs/truck-log/server/feature/rxo-documents/src/lib/rxo-documents.module.ts');
must(rxoDocuments.includes('DriverPrintDomainModule'), 'RXO Documents must consume Driver Print domain boundary');
must(!rxoDocuments.includes('DriverPrintModule'), 'RXO Documents must not depend on Driver Print HTTP feature');

const project = json('apps/truck-log-server/project.json');
must(project.targets?.build?.executor === '@nx/webpack:webpack', 'truck-log-server build must use @nx/webpack:webpack');
must(project.targets?.build?.options?.webpackConfig === 'apps/truck-log-server/webpack.config.js', 'truck-log-server build must use canonical Webpack config');
const webpack = read('apps/truck-log-server/webpack.config.js');
for (const marker of ['NxAppWebpackPlugin', "target: 'node'", "compiler: 'tsc'", "main: './src/main.ts'", "tsConfig: './tsconfig.app.json'", "filename: 'src/main.js'", "externalDependencies: 'all'"]) {
  must(webpack.includes(marker), `Backend Webpack config missing ${marker}`);
}

for (const retired of [
  'libs/truck-log/server/project.json',
  'libs/truck-log/server/src/index.ts',
  'libs/truck-log/server/src/lib',
]) must(!exists(retired), `Retired server umbrella remains: ${retired}`);

console.log('[PASS] Truck Log NestJS shell, core, domain, infrastructure, auth, and feature Nx boundaries are clean.');
