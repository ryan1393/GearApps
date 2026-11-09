import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

const smoke = read('tools/smoke-test-api.ps1');
const containerController = read('libs/server/feat-container/src/lib/server-feat-container.controller.ts');
const containerService = read('libs/server/feat-container/src/lib/server-feat-container.service.ts');
const locationController = read('libs/server/feat-location/src/lib/server-feat-location.controller.ts');
const locationService = read('libs/server/feat-location/src/lib/server-feat-location.service.ts');

must(smoke.includes('function Get-FirstEnabledCollectionItem'), 'Read-only API smoke test is missing the enabled-record collection helper.');
must(smoke.includes('$activeContainer = Get-FirstEnabledCollectionItem -Object $containers'), 'Container scan must select an enabled collection record.');
must(smoke.includes('$containerSerial = Get-FirstPropertyValue $activeContainer'), 'Container scan serial must come from the enabled record.');
must(smoke.includes('No enabled container source record.'), 'Container scan must explicitly SKIP when no enabled source exists.');

must(smoke.includes('$activeLocation = Get-FirstEnabledCollectionItem -Object $locations'), 'Location scan must select an enabled collection record.');
must(smoke.includes('$locationSerial = Get-FirstPropertyValue $activeLocation'), 'Location scan serial must come from the enabled record.');
must(smoke.includes('No enabled location source record.'), 'Location scan must explicitly SKIP when no enabled source exists.');

must(containerController.includes("@Get('scan/:serialNumber')"), 'Container scan route must remain GET scan/:serialNumber.');
must(containerService.includes('where: { serial_number: serialNumber.trim().toUpperCase(), enabled: true }'), 'Container scan service must remain enabled-only.');
must(locationController.includes("@Get('scan/:serialNumber')"), 'Location scan route must remain GET scan/:serialNumber.');
must(locationService.includes('where: { serial_number: serialNumber.trim().toUpperCase(), enabled: true }'), 'Location scan service must remain enabled-only.');

must(!smoke.includes('Invoke-GearGet "Blade Tracking" "Container Scan" "/containers/scan/$encodedContainer" -Optional'), 'A missing enabled container record must be skipped before request, not hide a real scan-route 404 as optional.');
must(!smoke.includes('Invoke-GearGet "Blade Tracking" "Location Scan" "/locations/scan/$encodedLocation" -Optional'), 'A missing enabled location record must be skipped before request, not hide a real scan-route 404 as optional.');

console.log('[PASS] Read-only API smoke source contract: scan probes select enabled source records and preserve enabled-only API semantics.');
