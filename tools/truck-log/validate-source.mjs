import { readFeatureSource, readDanaUiStyles, TRUCK_LOG_STYLES_ENTRY, DANA_UI_STYLES_ENTRY } from './source-contract-utils.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readSchemaSql, schemaIncludes } from './migration-sql.mjs';

const root = process.cwd();
const required = [
  'package.json','nx.json','tsconfig.base.json','.env.example',
  'apps/truck-log-server/project.json','apps/truck-log-server/src/main.ts','apps/truck-log-server/src/app/app.module.ts','apps/truck-log-server/webpack.config.js','libs/truck-log/server/core/project.json','libs/truck-log/server/core/src/index.ts','libs/truck-log/server/core/src/lib/truck-log-server.module.ts','tools/truck-log/test-server-boundaries.mjs','tools/truck-log/test-nx-project-boundaries.mjs','docs/truck-log/NX-WORKSPACE.md',
  'apps/truck-log/project.json','apps/truck-log/src/main.ts',
  'database/truck-log/migrations/0001_baseline.sql','tools/truck-log/migrate.mjs','SETUP-TRUCK-LOG.cmd','START-TRUCK-LOG.cmd',
  'database/truck-log/migrations/0001_baseline.sql','libs/truck-log/server/data-access/src/lib/entities/sap-document-type.entity.ts','libs/truck-log/server/data-access/src/lib/entities/sap-document-event.entity.ts','libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-documents.module.ts','libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-file-storage.ts','libs/truck-log/server/infrastructure/sap-documents/src/lib/sap-document-storage.service.ts','tools/truck-log/sap-document-reset-safety.mjs','tools/truck-log/test-sap-document-foundation-contract.mjs',
  'database/truck-log/migrations/0001_baseline.sql','tools/truck-log/migrate.mjs','libs/truck-log/server/feature/print-agents/src/lib/print-agents.module.ts','libs/truck-log/server/auth/print-agent/src/lib/print-agent-auth.guard.ts','libs/truck-log/server/feature/print-agents/src/lib/packing-slip-ingestion.service.ts','libs/truck-log/server/feature/print-agents/src/lib/dto/packing-slip-ingestion.dto.ts','tools/truck-log/test-packing-slip-ingestion-contract.mjs',
  'libs/truck-log/web/domain/src/lib/visit-display.ts','libs/truck-log/web/domain/src/lib/check-in-form.ts',
  'libs/truck-log/server/feature/docks/src/lib/dto/set-dock-active.dto.ts','libs/truck-log/server/feature/visits/src/lib/dto/workflow-action.dto.ts',
  'libs/truck-log/server/feature/visits/src/lib/dto/upload-document.dto.ts','libs/truck-log/server/feature/visits/src/lib/dto/upload-packing-slip.dto.ts','libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf-extractor.ts','libs/truck-log/server/feature/visits/src/lib/packing-slip-pdf.service.ts','libs/truck-log/server/feature/reference-data/src/lib/dto/reference-data.dto.ts','libs/truck-log/server/feature/reference-data/src/lib/reference-data.service.ts','libs/truck-log/server/feature/reference-data/src/lib/reference-data.controller.ts','libs/truck-log/server/data-access/src/lib/entities/driver-reference.entity.ts','libs/truck-log/server/data-access/src/lib/entities/carrier-reference.entity.ts','libs/truck-log/server/data-access/src/lib/entities/location-reference.entity.ts','docs/truck-log/REFERENCE-DATA.md','docs/truck-log/SCHEDULED-LOAD-EXCEL-IMPORT.md','libs/truck-log/server/feature/settings/src/lib/dto/update-dock-aging-settings.dto.ts','libs/truck-log/server/data-access/src/lib/entities/scheduled-load.entity.ts','libs/truck-log/server/feature/scheduled-loads/src/lib/scheduled-loads.service.ts','libs/truck-log/server/feature/scheduled-loads/src/lib/scheduled-loads.controller.ts','libs/truck-log/server/feature/settings/src/lib/app-settings.service.ts','libs/truck-log/server/feature/settings/src/lib/app-settings.controller.ts','libs/truck-log/web/domain/src/lib/dock-age.ts','libs/truck-log/web/styles/src/styles/truck-log.css','libs/truck-log/web/ui/src/lib/toast.service.ts','libs/truck-log/web/ui/src/lib/toast-host.component.ts','libs/truck-log/web/styles/src/styles/dock-board.css','libs/truck-log/web/styles/src/styles/ui.css','docs/truck-log/PACKING-SLIP-DOCK-UPLOAD.md','tools/truck-log/test-packing-slip-upload-contract.mjs',
  'apps/rxo-integration/project.json','apps/rxo-expedite/project.json','apps/rxo-integration/package.json','apps/rxo-integration/Dockerfile','apps/rxo-integration/src/rxo-fort-wayne-export.mjs','apps/rxo-integration/src/lib/rxo-filter-common.mjs','apps/rxo-integration/src/lib/rxo-filter-input.mjs','apps/rxo-integration/src/lib/rxo-filter-selection.mjs','apps/rxo-integration/src/lib/rxo-filter-panel.mjs','apps/rxo-integration/src/lib/rxo-filter-ui.mjs','apps/rxo-integration/src/lib/rxo-export-publication.mjs','apps/rxo-integration/RUNTIME-MANIFEST.json','apps/rxo-integration/start-integrated.ps1','apps/rxo-integration/sync-latest-to-truck-log.ps1','apps/rxo-expedite/src/cli.mjs','apps/rxo-expedite/src/scheduler.mjs','apps/rxo-expedite/src/lib/acquisition.mjs','tools/truck-log/rxo/validate-rxo-integration.mjs','tools/truck-log/rxo/build-rxo-integration.mjs','tools/truck-log/rxo/build-rxo-expedite.mjs','tools/truck-log/rxo/verify-local-rxo-latest.mjs','docs/truck-log/RXO-INTEGRATION.md'
];

// One Compose file: a nested apps/rxo-integration/docker-compose.yml declared the same
// project and recreated the production exporter with different settings.
if (fs.existsSync(path.join(root, 'apps/rxo-integration/docker-compose.yml'))) throw new Error('apps/rxo-integration/docker-compose.yml must not exist; use the root docker-compose.yml.');

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`Missing required file: ${rel}`);
}

for (const rel of ['package.json','nx.json','apps/truck-log-server/project.json','apps/truck-log/project.json','apps/rxo-integration/project.json','apps/rxo-expedite/project.json','apps/rxo-integration/package.json','apps/rxo-integration/RUNTIME-MANIFEST.json','libs/truck-log/shared/contracts/project.json','libs/truck-log/server/core/project.json','libs/truck-log/web/data-access/project.json','RELEASE-MANIFEST.json']) {
  JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}


const nx = JSON.parse(fs.readFileSync(path.join(root,'nx.json'),'utf8'));
const sharedGlobals = nx?.namedInputs?.sharedGlobals ?? [];
for (const entry of sharedGlobals) {
  if (typeof entry === 'string' && entry.startsWith('.') && !entry.startsWith('{workspaceRoot}/') && !entry.startsWith('{projectRoot}/')) {
    throw new Error(`Invalid Nx fileset in sharedGlobals: ${entry}. Use {workspaceRoot}/... or {projectRoot}/...`);
  }
}
if (!sharedGlobals.includes('{workspaceRoot}/.env')) {
  throw new Error('Nx sharedGlobals must include {workspaceRoot}/.env');
}


const setup = fs.readFileSync(path.join(root,'tools/truck-log/setup-truck-log.ps1'),'utf8');
if (setup.includes('NX_CACHE_PROJECT_GRAPH')) {
  throw new Error('Setup must not disable NX project-graph caching; @nx/js:tsc requires the graph.');
}
if (setup.includes('nx reset')) {
  throw new Error('Setup must not reset Nx immediately before build.');
}
if (!setup.includes('nx show projects')) {
  throw new Error('Setup must explicitly verify Nx project graph generation before build.');
}

const envPath = fs.existsSync(path.join(root,'.env')) ? path.join(root,'.env') : path.join(root,'.env.example');
const env = fs.readFileSync(envPath,'utf8');
for (const key of ['TRUCK_LOG_DATABASE_HOST','TRUCK_LOG_DATABASE_PORT','TRUCK_LOG_DATABASE_USERNAME','TRUCK_LOG_DATABASE_NAME','TRUCK_LOG_API_PORT','TRUCK_LOG_WEB_PORT','TRUCK_LOG_DOCUMENT_STORAGE_ROOT']) {
  if (!new RegExp(`^${key}=`, 'm').test(env)) throw new Error(`Missing env key: ${key}`);
}

const sql = readSchemaSql();
for (const table of ['truck_visits','visit_documents','visit_events','docks','drivers','carriers','locations','scheduled_loads']) {
  if (!schemaIncludes(`CREATE TABLE public.${table} (`)) throw new Error(`Missing table in migrations: ${table}`);
}

const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
if (!packageLock?.packages?.['node_modules/@nx/webpack']) {
  throw new Error('Backend library build requires the existing locked @nx/webpack package.');
}
const serverProject = JSON.parse(fs.readFileSync(path.join(root, 'apps/truck-log-server/project.json'), 'utf8'));
if (serverProject?.targets?.build?.executor !== '@nx/webpack:webpack') {
  throw new Error('truck-log-server must use the Nx Webpack build after backend extraction.');
}
const serverWebpack = fs.readFileSync(path.join(root, 'apps/truck-log-server/webpack.config.js'), 'utf8');
for (const marker of ['NxAppWebpackPlugin', "target: 'node'", "compiler: 'tsc'", "filename: 'src/main.js'"]) {
  if (!serverWebpack.includes(marker)) throw new Error(`Missing backend Webpack marker: ${marker}`);
}

// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
for (const marker of ['DOCK_COMPLETE','FINAL_GUARD_CHECKOUT','documentFolderKey','addPackingSlip','PACKING_SLIP_UPLOADED','extractedDocumentId']) {
  if (!service.includes(marker)) throw new Error(`Missing workflow marker: ${marker}`);
}

// Styling is owned by @dana/ui (loaded first by the app build); Truck Log keeps layout-only CSS per area.
const appProject = JSON.parse(fs.readFileSync(path.join(root, 'apps/truck-log/project.json'), 'utf8'));
const appStyles = appProject?.targets?.build?.options?.styles ?? [];
if (appStyles[0] !== DANA_UI_STYLES_ENTRY) throw new Error(`The Truck Log web build must load ${DANA_UI_STYLES_ENTRY} first.`);
const styles = fs.readFileSync(path.join(root, TRUCK_LOG_STYLES_ENTRY), 'utf8');
const stylesDir = path.join(root, path.dirname(TRUCK_LOG_STYLES_ENTRY));
for (const area of ['shell','ui','auth','operations','check-in','dock-board','records','rxo','tv','admin']) {
  if (!styles.includes(`@import "./${area}.css";`)) throw new Error(`Truck Log styles must import ${area}.css.`);
}

// Dock aging: the domain helper classifies the age and the Dock Board colors cards/badges with Dana tones.
const dockAge = fs.readFileSync(path.join(root, 'libs/truck-log/web/domain/src/lib/dock-age.ts'), 'utf8');
for (const marker of ['dock-age-warning','dock-age-critical','export function dockAgeTone']) {
  if (!dockAge.includes(marker)) throw new Error(`Missing dock-aging marker: ${marker}`);
}
const dockBoard = readFeatureSource(root, 'libs/truck-log/web/feature/dock-board/src/lib', ['.ts', '.html']);
for (const marker of ['dockAgeTone(visit, this.aging)', '[attr.data-tone]="ageTone(visit)"']) {
  if (!dockBoard.includes(marker)) throw new Error(`Dock Board must color dock age with Dana tones: ${marker}`);
}
// The Dock Alerts settings form lives in Administration > Dock Alerts.
const alertsTab = fs.readFileSync(path.join(root, 'libs/truck-log/web/feature/admin/src/lib/tabs/admin-alerts-tab.component.ts'), 'utf8');
for (const marker of ['name="warningMinutes"', 'name="criticalMinutes"', 'saveDockAging()']) {
  if (!alertsTab.includes(marker)) throw new Error(`Missing Dock Alerts settings marker: ${marker}`);
}

for (const file of fs.readdirSync(stylesDir).filter((name) => name.endsWith('.css'))) {
  const rel = path.relative(root, path.join(stylesDir, file));
  const css = fs.readFileSync(path.join(stylesDir, file), 'utf8');
  if (css.includes('\\n')) {
    throw new Error(`CSS contains literal escaped newline text instead of real line breaks: ${rel}`);
  }
  const opens = (css.match(/\{/g) ?? []).length;
  const closes = (css.match(/\}/g) ?? []).length;
  if (opens !== closes) throw new Error(`CSS brace mismatch in ${rel}: ${opens} opening / ${closes} closing`);
}

// Toasts: the host renders Dana toast markup with a tone class per notice; Dana UI styles each tone.
const toastHost = fs.readFileSync(path.join(root, 'libs/truck-log/web/ui/src/lib/toast-host.component.ts'), 'utf8');
const danaCss = readDanaUiStyles(root);
for (const marker of ['dana-toast-stack','toast-success','toast-warning','toast-error']) {
  if (!toastHost.includes(marker)) throw new Error(`Missing toast marker in toast host: ${marker}`);
  if (!danaCss.includes(marker)) throw new Error(`Dana UI no longer styles toast marker: ${marker}`);
}


const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson?.dependencies?.exceljs !== '4.4.0') {
  throw new Error('Scheduled-load Excel import requires exceljs 4.4.0.');
}
const scheduledImportService = fs.readFileSync(path.join(root, 'libs/truck-log/server/feature/scheduled-loads/src/lib/scheduled-loads.service.ts'), 'utf8');
for (const marker of ['ExcelJS', 'Scheduled Date', 'Scheduled Time', 'importWorkbook', 'templateWorkbook']) {
  if (!scheduledImportService.includes(marker)) throw new Error(`Missing scheduled-load Excel import marker: ${marker}`);
}


const rxoProject = JSON.parse(fs.readFileSync(path.join(root, 'apps/rxo-integration/project.json'), 'utf8'));
if (rxoProject.name !== 'rxo-integration') {
  throw new Error('RXO integration Nx project name must remain rxo-integration.');
}
const rxoBaseline = JSON.parse(fs.readFileSync(path.join(root, 'apps/rxo-integration/RUNTIME-MANIFEST.json'), 'utf8'));
const release = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (rxoBaseline.release !== release || rxoBaseline.validationStatus !== 'SOURCE_VERIFIED') {
  throw new Error(`RXO current runtime manifest is not release ${release}.`);
}
if (packageJson.version !== release) throw new Error(`package.json version ${packageJson.version} does not match VERSION ${release}.`);

console.log('[PASS] Truck Log static source contract.');
