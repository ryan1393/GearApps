import fs from 'node:fs';
import { readSchemaSql } from './migration-sql.mjs';

const read=(p)=>fs.readFileSync(p,'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(`[FAIL] ${msg}`);console.log(`[PASS] ${msg}`)};

const checkIn=(read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts') + '\n' + read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.html'));
const form=read('libs/truck-log/web/domain/src/lib/check-in-form.ts');
const dto=read('libs/truck-log/server/feature/visits/src/lib/dto/create-truck-visit.dto.ts');
const entity=read('libs/truck-log/server/data-access/src/lib/entities/truck-visit.entity.ts');
const service=read('libs/truck-log/server/feature/visits/src/lib/truck-visits.service.ts');
const contracts=read('libs/truck-log/shared/contracts/src/index.ts');
const schema=readSchemaSql();
const admin=(function adminFeatureSource(){const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(d+'/'+e.name):e.name.endsWith('.ts')?[d+'/'+e.name]:[]);return walk('libs/truck-log/web/feature/admin/src/lib').sort().map((f)=>fs.readFileSync(f,'utf8')).join('\n');})() /* admin.component.ts + one component per tab */;

must(!checkIn.includes('Location / Area'), 'Check-In has no obsolete Location / Area operator field');
for(const [name,text] of [['check-in form',form],['create DTO',dto],['visit entity',entity],['visit service',service],['shared contracts',contracts]]) {
  must(!/\blocationName\b/.test(text), `${name} has no obsolete standalone visit locationName`);
}
must(!/\blocation_name\b/.test(schema), 'bootstrap truck_visits schema has no obsolete location_name column/check');
must(checkIn.includes('{{requiredComplete}} of 10 required items complete'), 'Check-In required progress is 10 / 10');
must(checkIn.includes('<h2>Guard Notes</h2><span class="dana-field-tag">Optional</span>'), 'Optional guard notes remain available');

// These are a DIFFERENT domain concept and must survive visit-location removal.
must(admin.includes("activeAdminTab === 'drivers'") && admin.includes('Drivers'), 'Administration reusable Drivers master is preserved');
must(admin.includes("activeAdminTab === 'carriers'") && admin.includes('Carriers'), 'Administration reusable Carriers master is preserved');
must(admin.includes("activeAdminTab === 'locations'") && admin.includes('Locations') && admin.includes('used for origin and destination'), 'Administration reusable Locations master is preserved for Origin/Destination');
must(/\borigin_location_id\b/i.test(schema) && /\bdestination_location_id\b/i.test(schema), 'Origin/Destination location IDs remain in the visit schema');
must(schema.includes('plant_location_name'), 'Configured plant_location_name remains in app settings');
must(/originLocationId/.test(service) && /destinationLocationId/.test(service), 'Server still stores Origin/Destination reusable location IDs');

console.log('[PASS] Truck Log visit-location vs reusable-location domain distinction contract passed.');
