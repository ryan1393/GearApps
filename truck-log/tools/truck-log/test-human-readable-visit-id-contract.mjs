import fs from 'node:fs';
import { readFeatureSource } from './source-contract-utils.mjs';

const need = (condition, message) => {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
};

const contracts = fs.readFileSync('libs/truck-log/shared/contracts/src/index.ts', 'utf8');
const entity = fs.readFileSync('libs/truck-log/server/data-access/src/lib/entities/truck-visit.entity.ts', 'utf8');
// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
const slipRenderer = fs.readFileSync('libs/truck-log/server/feature/visits/src/lib/truck-visit-slip.renderer.ts', 'utf8');

need(contracts.includes('export function formatVisitReference(id: number)'), 'Shared contracts expose one canonical human-readable Visit ID formatter');
need(contracts.includes('visitReference: string;'), 'TruckVisitRecord exposes the human-readable Visit ID');
need(entity.includes('this.visitReference = formatVisitReference(this.id);'), 'TruckVisit entity hydrates Visit ID after persistence/load');
need(entity.includes('@AfterLoad()') && entity.includes('@AfterInsert()') && entity.includes('@AfterUpdate()'), 'Visit ID hydration covers loaded, newly inserted, and updated visits');
need(service.includes("CONCAT('TL-', LPAD(CAST(visit.id AS text), 6, '0')) ILIKE :needle"), 'Search accepts the readable TL-000123 Visit ID');
need(slipRenderer.includes('const visitReference = formatVisitReference(visit.id);'), 'Driver slip uses the shared readable Visit ID formatter');
need(slipRenderer.includes('<div class="label">Visit ID</div>'), 'Driver slip labels the short value as Visit ID');
need(slipRenderer.includes('<span>Visit ID ${esc(visitReference)}</span>'), 'Driver slip footer uses the readable Visit ID');

const visibleFiles = [
  'libs/truck-log/web/feature/active-trucks/src/lib/active-trucks.component.ts',
  'libs/truck-log/web/feature/dashboard/src/lib/dashboard.component.ts',
  'libs/truck-log/web/feature/history/src/lib/history.component.ts',
  'libs/truck-log/web/feature/dock-board/src/lib/dock-board.component.ts',
  'libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts',
];
for (const file of visibleFiles) {
  const source = file.endsWith('/check-in/check-in.component.ts')
    ? readFeatureSource(process.cwd(), 'libs/truck-log/web/feature/check-in/src/lib', ['.ts', '.html'])
    : fs.readFileSync(file, 'utf8');
  need(!/\{\{[^}]*visitNumber/.test(source), `${file} does not visibly render the long internal visit number`);
}
need(fs.readFileSync(visibleFiles[0], 'utf8').includes('v.visitReference'), 'Active Trucks shows the readable Visit ID');
need(fs.readFileSync(visibleFiles[1], 'utf8').includes('visit.visitReference'), 'Dashboard shows the readable Visit ID');
need(fs.readFileSync(visibleFiles[2], 'utf8').includes('selected.visitReference'), 'History detail shows the readable Visit ID');
need(fs.readFileSync(visibleFiles[3], 'utf8').includes('visit.visitReference'), 'Dock Board shows the readable Visit ID');
need(readFeatureSource(process.cwd(), 'libs/truck-log/web/feature/check-in/src/lib', ['.ts', '.html']).includes('lastVisit?.visitReference'), 'Check-In retry message uses the readable Visit ID');

need(service.includes('export function makeFolderKey(visitNumber: string'), 'Long internal visit number remains protected for folder compatibility');
need(service.includes('visit.visit_number ILIKE :needle'), 'Long internal visit number remains searchable for historical compatibility');

console.log('[PASS] Human-readable Visit ID contract passed.');
