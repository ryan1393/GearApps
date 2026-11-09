import { readFeatureSource } from './source-contract-utils.mjs';
import fs from 'node:fs';
import { readSchemaSql, schemaIncludes } from './migration-sql.mjs';

const read = (path) => fs.readFileSync(path, 'utf8');
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`[OK] ${message}`);
};

// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
const controller = read('libs/truck-log/server/feature/visits/src/lib/truck-visits.controller.ts');
const docksController = read('libs/truck-log/server/feature/docks/src/lib/docks.controller.ts');
const appModule = read('libs/truck-log/server/core/src/lib/truck-log-server.module.ts');
const uploadModule = read('libs/truck-log/server/infrastructure/uploads/src/lib/truck-log-upload.module.ts');
const dto = read('libs/truck-log/server/feature/visits/src/lib/dto/create-truck-visit.dto.ts');
const sql = readSchemaSql();
const api = read('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
const dashboard = read('libs/truck-log/web/feature/dashboard/src/lib/dashboard.component.ts');
const history = read('libs/truck-log/web/feature/history/src/lib/history.component.ts');
// Check-In page plus its print-package tracker (post-save print status and retries).
const checkin = (read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts') + '\n' + read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.html') + '\n' + read('libs/truck-log/web/feature/check-in/src/lib/driver-print-tracker.service.ts'));
const mock = read('tools/truck-log/mock-data.mjs');
const compose = read('docker-compose.yml');
const nginx = read('docker/truck-log/nginx.conf');
const setup = read('tools/truck-log/setup-truck-log.ps1');
const start = read('tools/truck-log/start-truck-log.ps1');
const serverStatuses = read('libs/truck-log/shared/contracts/src/index.ts');
const sharedContracts = read('libs/truck-log/shared/contracts/src/index.ts');
const checkinForm = read('libs/truck-log/web/domain/src/lib/check-in-form.ts');
const scheduledService = read('libs/truck-log/server/feature/scheduled-loads/src/lib/scheduled-loads.service.ts');
const scheduledController = read('libs/truck-log/server/feature/scheduled-loads/src/lib/scheduled-loads.controller.ts');
const referenceController = read('libs/truck-log/server/feature/reference-data/src/lib/reference-data.controller.ts');
const referenceService = read('libs/truck-log/server/feature/reference-data/src/lib/reference-data.service.ts');

must(!serverStatuses.includes('GUARD_CHECKED_IN'),
  'No unnecessary persisted guard-check-in status');
must(service.includes("from '@truck-log/shared/contracts'") &&
     dto.includes("from '@truck-log/shared/contracts'"),
  'Server implementation imports canonical shared workflow contracts');
for (const value of ['DOCK_ASSIGNED', 'DOCK_COMPLETE', 'GUARD_CHECKED_OUT', 'INBOUND', 'OUTBOUND']) {
  must(serverStatuses.includes(value) && sharedContracts.includes(value),
    `Server/shared contracts agree on ${value}`);
}
must(dto.includes('dockCode!: string') && !dto.includes('dockCode?: string'),
  'Dock is required by API DTO');
must(service.includes('is not an active configured dock'),
  'API validates active dock');

must(dto.includes('driverPhone!: string') && dto.includes('@MaxLength(50)'),
  'Driver Phone is required by API DTO');
must(sharedContracts.includes('driverPhone: string'),
  'Shared check-in request contract requires Driver Phone');
must(service.includes("Driver phone number is required.") && schemaIncludes('Driver Phone is required for every new truck visit'),
  'Driver Phone is enforced by API and database insert protection');
must(dto.includes('tractorId!: string') && !dto.includes('tractorId?: string'),
  'Tractor ID is required by API DTO');
must(dto.includes('isDropTrailer!: boolean') && checkinForm.includes('isDropTrailer: boolean') && checkinForm.includes('isDropTrailer: false'),
  'Drop Trailer defaults to No in the guard form and remains a boolean API field');
for (const field of ['originName!: string', 'destinationName!: string']) {
  must(dto.includes(field), `${field.split('!')[0]} is required by API DTO`);
}
const createRequestBlock = sharedContracts.slice(
  sharedContracts.indexOf('export interface CreateTruckVisitRequest'),
  sharedContracts.indexOf('export interface ScheduledLoadLookupRecord'),
);
must(dto.includes('loadNumber!: string') && dto.includes('@IsNotEmpty()') && createRequestBlock.includes('loadNumber: string'),
  'Load Number is required by both API DTO and shared request contract');
must(service.includes("Load Number is required.") && schemaIncludes('trg_truck_visits_required_insert'),
  'Load Number is enforced by the API and an insert-only database guard');
must(service.includes('plantLocationName') && service.includes('TruckDirections.OUTBOUND') && service.includes('TruckDirections.INBOUND'),
  'Server canonicalizes the Fort Wayne plant-side endpoint from Direction');
must(schemaIncludes("'plant_location_name', 'Fort Wayne'") && controller.includes("@Get('check-in-config')"),
  'Plant-side endpoint name is centralized in app_settings and exposed to check-in');
must(!dto.includes('scheduledAt') && !createRequestBlock.includes('scheduledAt'),
  'Check-in clients cannot supply scheduledAt');
must(schemaIncludes('CREATE TABLE IF NOT EXISTS scheduled_loads') && schemaIncludes('ux_scheduled_loads_active_load_number'),
  'Database has a dedicated scheduled-load source table');
must(schemaIncludes('trg_truck_visits_scheduled_source') && schemaIncludes('must come from an active scheduled_loads row'),
  'Database rejects non-null visit schedules that are not backed by scheduled_loads');
must(scheduledService.includes('findActiveByLoadNumber') && scheduledService.includes('scheduledLoad.active = true'),
  'Scheduled-load matching is an active exact load-number lookup');
must(
  service.includes('FROM scheduled_loads')
    && service.includes('WHERE UPPER(load_number) = $1 AND active = TRUE')
    && service.includes('scheduledAt: scheduledRows[0]?.scheduled_at ?? null'),
  'Visit scheduled_at comes only from the scheduled-load table');

must(scheduledController.includes("@Post('import')") && scheduledController.includes("@Get('template')") && scheduledController.includes("@Get()"),
  'Scheduled-load source supports Excel list/template/import endpoints');
must(scheduledService.includes("EXCEL_UPLOAD:") && scheduledService.includes('Schedule workbook was not imported.') && scheduledService.includes('appears more than once in this workbook'),
  'Excel schedule import is tagged and validates the whole workbook before writes');

must(scheduledController.includes("@Controller('scheduled-loads')") && scheduledController.includes("@Get('lookup')"),
  'UI has a read-only scheduled-load lookup endpoint');
must(referenceController.includes("@Controller('reference-data')") && referenceController.includes("@Get('check-in')"),
  'Reusable reference data has a dedicated API surface');
for (const route of ['drivers', 'carriers', 'locations']) {
  must(referenceController.includes(`@Get('${route}')`) && referenceController.includes(`@Post('${route}')`) && referenceController.includes(`@Patch('${route}/:id')`),
    `Reference-data admin supports ${route} list/create/update`);
}
must(schemaIncludes('CREATE TABLE IF NOT EXISTS drivers') && schemaIncludes('CREATE TABLE IF NOT EXISTS carriers') && schemaIncludes('CREATE TABLE IF NOT EXISTS locations'),
  'Database contains independent reusable driver, carrier, and location tables');
must(schemaIncludes('driver_id INTEGER') && schemaIncludes('carrier_id INTEGER') && schemaIncludes('origin_location_id INTEGER') && schemaIncludes('destination_location_id INTEGER'),
  'Truck visits retain optional master-data IDs alongside snapshot values');
must(service.includes('driverId') && service.includes('carrierId') && service.includes('originLocationId') && service.includes('destinationLocationId'),
  'New check-ins snapshot values while linking to reusable master records');
must(!/driver[^\n]{0,80}carrier_id/i.test(read('libs/truck-log/server/data-access/src/lib/entities/driver-reference.entity.ts')),
  'Driver master record is not permanently bound to a carrier');
must(referenceService.includes('last_used_at') && referenceService.includes('phone_number'),
  'Reference data tracks recent use and driver phone details');
must(checkinForm.includes('isDropTrailer: boolean') && checkinForm.includes('isDropTrailer: false') && !checkinForm.includes('boolean | null') && !checkinForm.includes('scheduledAt:'),
  'Check-in defaults Drop Trailer to No and has no manual scheduled-time field');
must(service.includes("lock: { mode: 'pessimistic_write' }"),
  'Workflow mutations use row locks');
must(service.includes('this.dataSource.transaction'),
  'Workflow/audit writes use transactions');
must(schemaIncludes('ck_truck_visits_status') && schemaIncludes('ck_truck_visits_dock_complete_time'),
  'Database enforces workflow constraints');

must(docksController.includes('SetDockActiveDto') && !docksController.includes('Boolean(body.active)'),
  'Dock activation body is validated as a real boolean');
must(controller.includes('WorkflowActionDto') && controller.includes('UploadDocumentDto'),
  'Workflow/document metadata request bodies use validated DTOs');
must(uploadModule.includes('MulterModule.registerAsync') && uploadModule.includes('fileSize'),
  'Paperwork size is limited before full upload buffering');
must(service.includes('maxStoredStemLength') && service.includes('255 - prefix.length'),
  'Stored paperwork names are bounded to the database column length');

must(api.includes("private readonly base = '/api/v1'"),
  'Browser API URL is same-origin');
must(nginx.includes('location /api/') &&
  nginx.includes('resolver 127.0.0.11 valid=10s ipv6=off;') &&
  nginx.includes('set $truck_log_api_backend truck-log-server:3334;') &&
  nginx.includes('proxy_pass http://$truck_log_api_backend;'),
  'Docker Nginx forwards API requests through runtime-resolved isolated Docker hostname');
must((compose.includes('TRUCK_LOG_API_PORT: \"3334\"') || compose.includes('TRUCK_LOG_API_PORT: 3334')) && compose.includes("fetch('http://127.0.0.1:3334/api/v1/health')"),
  'Docker container uses the fixed internal API port and database/storage readiness health');

must(dashboard.includes('awaitingGuard'),
  'Guard action queue uses a dedicated dock-complete result set');
must(service.includes('awaitingGuard: awaitingGuardVisits'),
  'Dashboard API returns dedicated waiting-for-guard visits');
must(history.includes('openRecord') && history.includes('documentUrl'),
  'Records can retrieve scanned paperwork');
must(checkin.includes("const retryWindow = window.open('about:blank'") && checkin.includes('retryWindow.location.href'),
  'Manual Dock Assignment retry opens its print window from the user gesture');
must(checkin.includes('toCreateTruckVisitRequest'),
  'Check-in uses a typed request mapper');
must(service.includes('AT TIME ZONE :timeZone'),
  'Operator date calculations use the configured plant timezone');

must(mock.includes("'MOCK-01'") && mock.includes("'[MOCK] Receiving 1'"),
  'Mock docks use an isolated MOCK-* namespace');
must(mock.includes('already belongs to a non-mock dock'),
  'Mock seed refuses to overwrite a real dock collision');
must(mock.includes('LEGACY_MOCK_DOCK_CODES') && mock.includes("description LIKE 'Mock %'"),
  'Mock cleanup supports only visibly tagged legacy mock docks');

must(setup.includes('npm run build') && setup.includes('npm run validate:release') &&
     !setup.includes('ensure-database.mjs') && !setup.includes('bootstrap-database.mjs'),
  'Development workspace setup builds/validates without mutating the database');
must(start.includes('http://localhost:$WebPort') && !start.includes('http://127.0.0.1:$WebPort'),
  'Operator browser URL remains localhost');
must(read('.dockerignore').includes('.env'),
  'Docker build context excludes .env');
for (const ignoredHostPath of [
  'data/**',
  '_patch_backups/**',
  'patch_backups/**',
  'backups/**',
  '*.bak-*',
  '*.zip',
  '.new-host-state',
]) {
  must(
    read('.dockerignore').includes(ignoredHostPath),
    `Docker build context excludes host-only path: ${ignoredHostPath}`,
  );
}

console.log('[PASS] Truck Log workflow/refactor contract.');
