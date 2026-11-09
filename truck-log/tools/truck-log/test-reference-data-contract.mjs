import { readFeatureSource } from './source-contract-utils.mjs';
import fs from 'node:fs';
import { readSchemaSql, schemaIncludes } from './migration-sql.mjs';

const read = (path) => fs.readFileSync(path, 'utf8');
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`[OK] ${message}`);
};

const sql = readSchemaSql();
const dto = read('libs/truck-log/server/feature/visits/src/lib/dto/create-truck-visit.dto.ts');
const visitEntity = read('libs/truck-log/server/data-access/src/lib/entities/truck-visit.entity.ts');
// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
const slipRenderer = read('libs/truck-log/server/feature/visits/src/lib/truck-visit-slip.renderer.ts');
const referenceController = read('libs/truck-log/server/feature/reference-data/src/lib/reference-data.controller.ts');
const referenceService = read('libs/truck-log/server/feature/reference-data/src/lib/reference-data.service.ts');
const contracts = read('libs/truck-log/shared/contracts/src/index.ts');
const checkin = (read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts') + '\n' + read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.html'));
const admin = (function adminFeatureSource(){const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(d+'/'+e.name):e.name.endsWith('.ts')?[d+'/'+e.name]:[]);return walk('libs/truck-log/web/feature/admin/src/lib').sort().map((f)=>fs.readFileSync(f,'utf8')).join('\n');})() /* admin.component.ts + one component per tab */;
const history = read('libs/truck-log/web/feature/history/src/lib/history.component.ts');
const api = read('libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
const mock = read('tools/truck-log/mock-data.mjs');

for (const table of ['drivers','carriers','locations']) {
  must(schemaIncludes(`CREATE TABLE IF NOT EXISTS ${table}`), `Schema creates ${table}`);
}

for (const index of [
  'ux_drivers_normalized_name',
  'ux_carriers_normalized_name',
  'ux_locations_normalized_name',
]) {
  must(schemaIncludes(index), `Schema has ${index}`);
}

for (const column of [
  'driver_id',
  'driver_phone',
  'carrier_id',
  'origin_location_id',
  'destination_location_id',
]) {
  must(schemaIncludes(column), `Schema includes truck visit ${column}`);
}

for (const fk of [
  'fk_truck_visits_driver_reference',
  'fk_truck_visits_carrier_reference',
  'fk_truck_visits_origin_location_reference',
  'fk_truck_visits_destination_location_reference',
]) {
  must(schemaIncludes(fk), `Schema protects ${fk}`);
}

must(dto.includes('driverPhone!: string') && dto.includes('@IsNotEmpty()'),
  'Driver Phone is required by the API DTO');
must(contracts.includes('driverPhone: string'),
  'Driver Phone is required by the browser/server contract');
must(visitEntity.includes("name: 'driver_phone'") && visitEntity.includes("name: 'driver_id'"),
  'Truck visit entity carries driver phone snapshot and driver master ID');
must(visitEntity.includes("name: 'carrier_id'") && visitEntity.includes("name: 'origin_location_id'") && visitEntity.includes("name: 'destination_location_id'"),
  'Truck visit entity carries reusable carrier/location IDs');

must(service.includes('upsertDriverReference') && service.includes('upsertCarrierReference') && service.includes('upsertLocationPair'),
  'Check-in upserts reusable master data');
must(service.includes('driverPhone') && service.includes('driverId') && service.includes('carrierId'),
  'Check-in stores master IDs and snapshot Driver Phone');
must(service.includes('visit.driver_phone ILIKE :needle'),
  'Visit search includes Driver Phone');
must(slipRenderer.includes("field('Driver Phone', visit.driverPhone)"),
  'Professional printed slip includes Driver Phone');
must(slipRenderer.includes('DRIVER SIGNATURE') && slipRenderer.includes('danaLogoDataUri'),
  'Professional Dana slip and driver signature remain preserved');

must(referenceController.includes("@Get('check-in')"),
  'Check-In has a single active reference-data endpoint');
for (const route of ['drivers','carriers','locations']) {
  must(referenceController.includes(`@Get('${route}')`), `${route} list endpoint exists`);
  must(referenceController.includes(`@Post('${route}')`), `${route} create endpoint exists`);
  must(referenceController.includes(`@Patch('${route}/:id')`), `${route} update endpoint exists`);
}
must(referenceService.includes('includeInactive') && referenceService.includes('last_used_at'),
  'Admin can include disabled records and display Last Used');

const requiredItemList = checkin.match(/get missingRequiredItems\(\) \{[\s\S]*?const required[^=]*= \[([\s\S]*?)\];/)?.[1] ?? '';
must((requiredItemList.match(/\['[^']+', /g) ?? []).length === 10 && requiredItemList.includes("['Driver Phone', this.driverPhoneValid]")
  && checkin.includes('{{requiredComplete}} of 10 required items complete') && checkin.includes('get requiredComplete() { return 10 - this.missingRequiredItems.length; }')
  && /for="checkin-driver-phone">Driver Phone<\/label><span class="dana-field-tag is-required">Required<\/span>/.test(checkin),
  'Check-In exposes Driver Phone as the tenth required item');
must(checkin.includes('[options]="referenceDrivers"') && checkin.includes('[options]="referenceCarriers"') && (checkin.match(/\[options\]="referenceLocations"/g) ?? []).length === 2 && checkin.includes('api.checkInReferenceData()'),
  'Check-In reuses Drivers, Carriers, and Locations');
must(checkin.includes('driverSelectionChanged') && checkin.includes('match.phoneNumber'),
  'Known Driver selection can fill saved phone');
must(admin.includes('<h2>Drivers</h2>') && admin.includes('<h2>Carriers</h2>') && admin.includes('<h2>Locations</h2>'),
  'Administration manages all three reusable master lists');
must(admin.includes('a returning driver can come with a different carrier'),
  'Administration explains driver/carrier independence');
must(history.includes('<span class="dana-detail-label">Driver phone</span>') && history.includes('selected.driverPhone'),
  'Historical record detail displays the snapshotted Driver Phone');
must(api.includes('checkInReferenceData') && api.includes('createDriver') && api.includes('createCarrier') && api.includes('createLocation'),
  'Angular API exposes reference-data calls');
must(mock.includes('driver_phone') && mock.includes('260-555-'),
  'Mock direct inserts satisfy the new Driver Phone insert guard');

must(!referenceService.toLowerCase().includes('legacy_sqlserver'),
  'Reference-data runtime does not silently import the legacy SQL Server database');

console.log('[PASS] Truck Log reference-data / Driver Phone contract.');
