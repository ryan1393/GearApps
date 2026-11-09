import fs from 'node:fs';
import path from 'node:path';
import { readFeatureSource } from './source-contract-utils.mjs';

const root = process.cwd();
const componentPath = path.join(root, 'libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts');
const apiPath = path.join(root, 'libs/truck-log/web/data-access/src/lib/truck-log-api.service.ts');
const ingestionPath = path.join(root, 'libs/truck-log/server/feature/rxo-ingestion/src/lib/rxo-ingestion.service.ts');

const component = readFeatureSource(root, 'libs/truck-log/web/feature/check-in/src/lib', ['.ts', '.html']);
const api = fs.readFileSync(apiPath, 'utf8');
const ingestion = readFeatureSource(
  root,
  'libs/truck-log/server/feature/rxo-ingestion/src/lib',
  ['.ts'],
);

const must = (condition, message) => {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
};

must(component.includes("RxoFreightRecord"), 'Check-In imports the RXO freight record contract');
must(component.includes("this.api.rxoData<RxoFreightRecord>('freight'"), 'Check-In loads current Freight On The Move data through the existing RXO API');
must(component.includes('[keyOf]="freightLoadKeyFn"') && component.includes('readonly freightLoadKeyFn = (load: RxoFreightRecord) => this.loads.freightLoadKey(load);')
  && component.includes('return [load.site_key, load.direction, load.shipment_id]')
  && component.includes('[(ngModel)]="selectedFreightKey"') && component.includes('this.freightLoads.find((row) => this.freightLoadKey(row) === normalizedKey)')
  && component.includes('this.form.loadNumber = selected.shipment_id.trim().toUpperCase()'), 'Load selection uses a collision-safe tuple key while shipment_id remains the business load number');
must(/<dana-combobox\s+\*ngIf="!manualLoadEntry"[^>]*ariaLabel="RXO or Expedite load"[^>]*\[options\]="freightLoads"/.test(component) && component.includes('emptyText="No RXO or Expedite load matches"'), 'Check-In presents the consolidated RXO and Expedite load selector');
must(component.includes('(click)="useManualLoadEntry()">Type it</button>') && /<input\s+\*ngIf="manualLoadEntry"\s+id="checkin-load-manual"/.test(component) && component.includes('this.loads.onNoneAvailable = () => { this.manualLoadEntry = true; };'), 'Manual load-number fallback remains available');
must(component.includes('Freight On The Move is temporarily unavailable. Manual load entry is still available.'), 'RXO outage does not block manual guard check-in');
must(component.includes('this.setDirection(selected.direction)'), 'Selecting a Freight On The Move load applies its direction');
must(component.includes("this.form.carrierName = selected.carrier_name?.trim() || ''"), 'Selecting a load always replaces Carrier with the selected RXO carrier');
must(!component.includes('!this.form.carrierName.trim() && selected.carrier_name'), 'A prior Carrier value cannot block RXO load selection from updating Carrier');
must(component.includes("this.form.trailerId = selected.trailer_number?.trim().toUpperCase() || ''"), 'Selecting a load replaces Trailer ID with the selected RXO trailer instead of leaving stale load data');
must(component.includes("this.form.originName = selected.first_stop_address?.trim() || ''"), 'Inbound RXO selection replaces Origin with the selected load origin');
must(component.includes("this.form.destinationName = selected.last_stop_address?.trim() || ''"), 'Outbound RXO selection replaces Destination with the selected load destination');
must(ingestion.includes('carrier_name,'), 'Freight On The Move API query includes carrier_name from PostgreSQL');
must(component.includes('this.lookupSchedule();'), 'Selected load still uses the scheduled-load lookup workflow');
must(api.includes("kind: 'orders' | 'shipments' | 'freight'"), 'Frontend RXO data API supports the freight dataset');
must(ingestion.includes('FROM rxo_freight_visibility'), 'Freight On The Move selector is backed by the RXO freight visibility dataset');
must(ingestion.includes('visible_in_latest=TRUE'), 'Freight source remains limited to current-visible RXO rows');
must(ingestion.includes("activeRxoStatusClause('status')"), 'Freight selector excludes terminal RXO loads');
must(ingestion.includes("activeRxoPlantWindowClause('plant_scheduled_at', plantTimeZoneToken)"), 'Freight selector is limited to yesterday through tomorrow in plant time');
must(component.includes('rxoExpediteCheckInLoads') && component.includes('loadStandardFreightPage'), 'Check-In merges standard RXO and Expedite check-in sources');
must(ingestion.includes('load_number: row.shipmentId'), 'Scheduled-load sync uses the same shipment ID as the Check-In load number');

console.log('[PASS] Check-In Freight On The Move load-selector contract passed.');
